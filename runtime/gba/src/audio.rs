//! Four-voice software synthesizer on Direct Sound A.
//!
//! The SDK's sequencer (sdk/audio.ts) sends one voice record per channel per
//! audio tick (76 samples, about 1/239 s): tone, 16.16 phase step per sample
//! of a 32-sample waveform, and amplitude. The main loop queues the records;
//! the VBlank IRQ mixes four ticks into 304 signed 8-bit samples at 18157 Hz,
//! exactly one frame of samples, and restarts DMA 1 on the buffer mixed the
//! frame before. Waveforms follow pyxel-core's default tones: a 4-bit
//! triangle, a 50% square, a 25% pulse and 15-bit LFSR noise. A channel's
//! amplitude moves to each record's value over its first 16 samples, as
//! Pyxel fades notes in and out over 0.8 ms, so notes start and end without
//! clicks.

use core::ptr::{addr_of, addr_of_mut, read_volatile, write_volatile};

use crate::hw;

pub const SAMPLES_PER_FRAME: usize = 304;
const TICKS_PER_FRAME: usize = 4;
const SAMPLES_PER_TICK: usize = SAMPLES_PER_FRAME / TICKS_PER_FRAME;
/// Samples over which a channel's amplitude moves to a new record's value.
const RAMP_SAMPLES: usize = 16;
const CHANNELS: usize = 4;
/// Ticks of voice records the queue holds; the host keeps about 16 queued.
const QUEUE_TICKS: usize = 32;
pub const TARGET_TICKS: u32 = 16;

const SOUNDCNT_L: usize = 0x0400_0080;
const SOUNDCNT_H: usize = 0x0400_0082;
const SOUNDCNT_X: usize = 0x0400_0084;
const FIFO_A: usize = 0x0400_00a0;
const DMA1SAD: usize = 0x0400_00bc;
const DMA1DAD: usize = 0x0400_00c0;
const DMA1CNT_H: usize = 0x0400_00c6;
const TM0CNT_L: usize = 0x0400_0100;
const TM0CNT_H: usize = 0x0400_0102;

/// Waveforms as 32 samples in -15..15, indexed by tone, kept in IWRAM for the mixer.
#[link_section = ".iwram.waves"]
static WAVES: [[i8; 32]; 3] = [
    [
        1, 3, 5, 7, 9, 11, 13, 15, 15, 13, 11, 9, 7, 5, 3, 1, -1, -3, -5, -7, -9, -11, -13, -15, -15, -13, -11, -9, -7,
        -5, -3, -1,
    ],
    [
        15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, -15, -15, -15, -15, -15, -15, -15, -15, -15,
        -15, -15, -15, -15, -15, -15, -15,
    ],
    [
        15, 15, 15, 15, 15, 15, 15, 15, -15, -15, -15, -15, -15, -15, -15, -15, -15, -15, -15, -15, -15, -15, -15, -15,
        -15, -15, -15, -15, -15, -15, -15, -15,
    ],
];

#[derive(Clone, Copy)]
struct Voice {
    tone: i32,
    step: u32,
    amplitude: i32,
}

const SILENT: Voice = Voice {
    tone: -1,
    step: 0,
    amplitude: 0,
};

struct Mixer {
    queue: [[Voice; CHANNELS]; QUEUE_TICKS],
    /// Written by the main loop only.
    head: u32,
    /// Written by the IRQ handler only.
    tail: u32,
    current: [Voice; CHANNELS],
    /// The last voice that sounded on each channel, which a fade-out continues.
    sounding: [Voice; CHANNELS],
    /// Amplitude each channel ended the last tick at.
    level: [i32; CHANNELS],
    phase: [u32; CHANNELS],
    noise: [u32; CHANNELS],
    buffers: [[i8; SAMPLES_PER_FRAME]; 2],
    playing: usize,
    enabled: bool,
}

static mut MIXER: Mixer = Mixer {
    queue: [[SILENT; CHANNELS]; QUEUE_TICKS],
    head: 0,
    tail: 0,
    current: [SILENT; CHANNELS],
    sounding: [SILENT; CHANNELS],
    level: [0; CHANNELS],
    phase: [0; CHANNELS],
    noise: [0x7001; CHANNELS],
    buffers: [[0; SAMPLES_PER_FRAME]; 2],
    playing: 0,
    enabled: false,
};

pub fn start() {
    unsafe {
        let mixer = &mut *addr_of_mut!(MIXER);
        mixer.noise = [0x7001; CHANNELS];
        mixer.enabled = true;
        hw::write16(SOUNDCNT_X, 0x0080);
        hw::write16(SOUNDCNT_L, 0);
        // Direct Sound A at full volume on both speakers, timer 0, FIFO reset.
        hw::write16(SOUNDCNT_H, 0x0b0e);
        hw::write16(TM0CNT_H, 0);
        hw::write16(TM0CNT_L, (65536 - 16_777_216 / 18157) as u16);
        hw::write16(TM0CNT_H, 0x0080);
        restart_dma(mixer.buffers[0].as_ptr());
    }
}

unsafe fn restart_dma(source: *const i8) {
    hw::write16(DMA1CNT_H, 0);
    write_volatile(DMA1SAD as *mut u32, source as u32);
    write_volatile(DMA1DAD as *mut u32, FIFO_A as u32);
    // Enable, sound FIFO timing, repeat, 32-bit, fixed destination.
    hw::write16(DMA1CNT_H, 0xb640);
}

/// Ticks queued and not yet mixed.
pub fn queued() -> u32 {
    unsafe {
        let head = read_volatile(addr_of!(MIXER.head));
        let tail = read_volatile(addr_of!(MIXER.tail));
        head.wrapping_sub(tail)
    }
}

/// Queues voice records produced by the sequencer: 3 values per channel per tick.
pub fn push(records: &[i32]) {
    unsafe {
        let mixer = &mut *addr_of_mut!(MIXER);
        for tick in records.chunks_exact(3 * CHANNELS) {
            if queued() as usize >= QUEUE_TICKS {
                break;
            }
            let slot = &mut mixer.queue[mixer.head as usize % QUEUE_TICKS];
            for (voice, record) in slot.iter_mut().zip(tick.chunks_exact(3)) {
                *voice = Voice {
                    tone: record[0],
                    step: record[1] as u32,
                    amplitude: record[2],
                };
            }
            write_volatile(addr_of_mut!(mixer.head), mixer.head.wrapping_add(1));
        }
    }
}

/// VBlank: plays the buffer mixed last frame and mixes the next one.
#[link_section = ".iwram.audio_vblank"]
#[instruction_set(arm::a32)]
pub fn vblank() {
    unsafe {
        let mixer = &mut *addr_of_mut!(MIXER);
        if !mixer.enabled {
            return;
        }
        restart_dma(mixer.buffers[mixer.playing].as_ptr());
        let next = mixer.playing ^ 1;
        mixer.playing = next;
        for part in 0..TICKS_PER_FRAME {
            // Holding the last voices through a late frame keeps notes sounding.
            if mixer.head != mixer.tail {
                mixer.current = mixer.queue[mixer.tail as usize % QUEUE_TICKS];
                write_volatile(addr_of_mut!(mixer.tail), mixer.tail.wrapping_add(1));
            }
            let out = &mut mixer.buffers[next][part * SAMPLES_PER_TICK..(part + 1) * SAMPLES_PER_TICK];
            mix(
                out,
                &mixer.current,
                &mut mixer.sounding,
                &mut mixer.level,
                &mut mixer.phase,
                &mut mixer.noise,
            );
        }
    }
}

// ARM code cannot inline Thumb functions, so the mixer loops index directly
// instead of calling iterator adapters or Ord::clamp.
#[link_section = ".iwram.audio_mix"]
#[instruction_set(arm::a32)]
#[inline(never)]
fn mix(
    out: &mut [i8],
    voices: &[Voice; CHANNELS],
    sounding: &mut [Voice; CHANNELS],
    level: &mut [i32; CHANNELS],
    phase: &mut [u32; CHANNELS],
    noise: &mut [u32; CHANNELS],
) {
    let mut sum = [0i32; SAMPLES_PER_TICK];
    let mut channel = 0;
    while channel < CHANNELS {
        let c = channel;
        channel += 1;
        let voice = voices[c];
        // A silent record fades the last sounding voice out.
        let target = if voice.tone < 0 { 0 } else { voice.amplitude };
        if voice.tone >= 0 {
            sounding[c] = voice;
        }
        let from = level[c];
        level[c] = target;
        let played = sounding[c];
        if played.tone < 0 || (from == 0 && target == 0) {
            continue;
        }
        let mut position = phase[c];
        let mut i = 0;
        if played.tone == 3 {
            // One shift of the 15-bit LFSR (tap bit 1) per 1.0 of phase.
            let mut lfsr = noise[c];
            while i < SAMPLES_PER_TICK {
                let amplitude = if i < RAMP_SAMPLES {
                    from + (((target - from) * (i as i32 + 1)) >> 4)
                } else {
                    target
                };
                position = position.wrapping_add(played.step);
                while position >= 0x1_0000 {
                    position -= 0x1_0000;
                    let feedback = (lfsr ^ (lfsr >> 1)) & 1;
                    lfsr = (lfsr >> 1) | (feedback << 14);
                }
                sum[i] += if lfsr & 1 == 0 { 15 * amplitude } else { -15 * amplitude };
                i += 1;
            }
            noise[c] = lfsr;
        } else {
            let wave = &WAVES[if played.tone > 2 { 2 } else { played.tone as usize }];
            while i < RAMP_SAMPLES {
                let amplitude = from + (((target - from) * (i as i32 + 1)) >> 4);
                position = position.wrapping_add(played.step);
                sum[i] += wave[((position >> 16) & 31) as usize] as i32 * amplitude;
                i += 1;
            }
            while i < SAMPLES_PER_TICK {
                position = position.wrapping_add(played.step);
                sum[i] += wave[((position >> 16) & 31) as usize] as i32 * target;
                i += 1;
            }
        }
        phase[c] = position;
    }
    let mut i = 0;
    while i < SAMPLES_PER_TICK && i < out.len() {
        let value = sum[i] >> 6;
        out[i] = if value > 127 {
            127
        } else if value < -128 {
            -128
        } else {
            value as i8
        };
        i += 1;
    }
}
