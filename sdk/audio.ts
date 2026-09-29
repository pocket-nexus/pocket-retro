/**
 * Pyxel's sound sequencer. Sounds and musics play on four channels; each
 * audio tick (1/120 s) the sequencer turns every channel's current note into
 * voice parameters for the host's mixer, which synthesizes the waveforms.
 *
 * The semantics follow pyxel-core sound.rs and voice.rs: a note lasts `speed`
 * ticks; C0 is MIDI note 36 for wavetable tones and 60 for noise; slide
 * glides from the previous note, vibrato is a 6 Hz ±25-cent triangle, and
 * the fade effects ramp volume to zero over the note, its last half or its
 * last quarter.
 */
import {
  codePoints,
  f64,
  fill,
  i32,
  idiv,
  len,
  pow,
  push,
  round,
  type f64 as F64,
  type i32 as I32,
} from "@pocketjs/framework/solid/std";
import { MUSIC_STARTS, MUSICS, SOUND_STARTS, SOUNDS } from "./assets";
import { AUDIO_RATE, pushVoice } from "./hw";

export const NUM_CHANNELS: I32 = 4;
export const NUM_SOUNDS: I32 = 64;
export const NUM_MUSICS: I32 = 8;
export const TONE_TRIANGLE: I32 = 0;
export const TONE_SQUARE: I32 = 1;
export const TONE_PULSE: I32 = 2;
export const TONE_NOISE: I32 = 3;
export const EFFECT_NONE: I32 = 0;
export const EFFECT_SLIDE: I32 = 1;
export const EFFECT_VIBRATO: I32 = 2;
export const EFFECT_FADEOUT: I32 = 3;
export const EFFECT_HALF_FADEOUT: I32 = 4;
export const EFFECT_QUARTER_FADEOUT: I32 = 5;
const MAX_VOLUME: I32 = 7;
const VIBRATO_PERIOD: I32 = 20;
// Tone gains (pyxel-core settings.rs) x channel gain 0.125 x a master gain of
// 3 for the 8-bit output, scaled so that amp * sample >> 6 is the output for
// waveform samples in -15..15. Indexed by tone.
const TONE_AMP: I32[] = [203, 61, 61, 122];

let soundNotes: I32[][] = [];
let soundTones: I32[][] = [];
let soundVolumes: I32[][] = [];
let soundEffects: I32[][] = [];
let soundSpeeds: I32[] = [];
let musicSeqs: I32[][] = [];

// Channel state, indexed by channel.
let chPlaying: boolean[] = [false, false, false, false];
let chLoop: boolean[] = [false, false, false, false];
let chSounds: I32[][] = [[], [], [], []];
let chSound: I32[] = [0, 0, 0, 0];
let chNote: I32[] = [0, 0, 0, 0];
let chTick: I32[] = [0, 0, 0, 0];
let chPlayback: I32[] = [0, 0, 0, 0];
/** Previous note in 1/64 semitones, or -1; slide starts from it. */
let chLastPitch: I32[] = [-1, -1, -1, -1];
let chGlide: I32[] = [0, 0, 0, 0];
/** Phase step per output sample of a 32-sample waveform at each MIDI note, 16.16 fixed point. */
let noteSteps: I32[] = fill(129, 0);

export function reset(): void {
  const scale: F64 = f64(32 * 65536) / f64(AUDIO_RATE);
  for (let m = 0; m <= 128; m++) noteSteps[m] = i32(round(f64(440) * pow(f64(2), f64(m - 69) / f64(12)) * scale));
  soundNotes = [];
  soundTones = [];
  soundVolumes = [];
  soundEffects = [];
  soundSpeeds = [];
  for (let n = 0; n < NUM_SOUNDS; n++) {
    push(soundNotes, []);
    push(soundTones, []);
    push(soundVolumes, []);
    push(soundEffects, []);
    push(soundSpeeds, 30);
    const start = n < len(SOUND_STARTS) ? SOUND_STARTS[n] : -1;
    if (start >= 0) loadSound(n, start);
  }
  musicSeqs = [];
  for (let n = 0; n < NUM_MUSICS * NUM_CHANNELS; n++) push(musicSeqs, []);
  for (let n = 0; n < NUM_MUSICS; n++) {
    const start = n < len(MUSIC_STARTS) ? MUSIC_STARTS[n] : -1;
    if (start < 0) continue;
    let at = start + NUM_CHANNELS;
    for (let c = 0; c < NUM_CHANNELS; c++) {
      for (let i = 0; i < MUSICS[start + c]; i++) push(musicSeqs[n * NUM_CHANNELS + c], MUSICS[at + i]);
      at += MUSICS[start + c];
    }
  }
  for (let c = 0; c < NUM_CHANNELS; c++) stop(c);
}

/** Reads a baked sound record: speed, four lengths, then the four lists. */
function loadSound(n: I32, start: I32): void {
  soundSpeeds[n] = SOUNDS[start];
  let at = start + 5;
  for (let i = 0; i < SOUNDS[start + 1]; i++) push(soundNotes[n], SOUNDS[at + i]);
  at += SOUNDS[start + 1];
  for (let i = 0; i < SOUNDS[start + 2]; i++) push(soundTones[n], SOUNDS[at + i]);
  at += SOUNDS[start + 2];
  for (let i = 0; i < SOUNDS[start + 3]; i++) push(soundVolumes[n], SOUNDS[at + i]);
  at += SOUNDS[start + 3];
  for (let i = 0; i < SOUNDS[start + 4]; i++) push(soundEffects[n], SOUNDS[at + i]);
}

// ---- Editing sounds and musics ------------------------------------------

/**
 * Pyxel's Sound.set: notes like "c2e2g2r", tones "tspn", volumes "0"-"7",
 * effects "nsvfhq" and a speed in ticks per note. Spaces are ignored.
 */
export function setSound(n: I32, notes: string, tones: string, volumes: string, effects: string, speed: I32): void {
  if (n < 0 || n >= NUM_SOUNDS) return;
  soundNotes[n] = parseNotes(notes);
  soundTones[n] = parseLetters(tones, "tspn");
  soundVolumes[n] = parseLetters(volumes, "01234567");
  soundEffects[n] = parseLetters(effects, "nsvfhq");
  soundSpeeds[n] = speed > 0 ? speed : 1;
}

export function setSoundSpeed(n: I32, speed: I32): void {
  if (n >= 0 && n < NUM_SOUNDS && speed > 0) soundSpeeds[n] = speed;
}

/** Pyxel's Music.set: one list of sound numbers per channel. */
export function setMusic(n: I32, seq0: I32[], seq1: I32[], seq2: I32[], seq3: I32[]): void {
  if (n < 0 || n >= NUM_MUSICS) return;
  musicSeqs[n * NUM_CHANNELS] = seq0;
  musicSeqs[n * NUM_CHANNELS + 1] = seq1;
  musicSeqs[n * NUM_CHANNELS + 2] = seq2;
  musicSeqs[n * NUM_CHANNELS + 3] = seq3;
}

function parseNotes(text: string): I32[] {
  const notes: I32[] = [];
  const codes = codePoints(text);
  let i = 0;
  while (i < len(codes)) {
    const c = lower(codes[i]);
    i++;
    if (c === 114) {
      push(notes, -1);
      continue;
    }
    // c d e f g a b
    let note =
      c === 99
        ? 0
        : c === 100
          ? 2
          : c === 101
            ? 4
            : c === 102
              ? 5
              : c === 103
                ? 7
                : c === 97
                  ? 9
                  : c === 98
                    ? 11
                    : -100;
    if (note < 0) continue;
    if (i < len(codes) && codes[i] === 35) {
      note++;
      i++;
    } else if (i < len(codes) && codes[i] === 45) {
      note--;
      i++;
    }
    if (i < len(codes) && codes[i] >= 48 && codes[i] <= 52) {
      note += (codes[i] - 48) * 12;
      i++;
    }
    push(notes, note);
  }
  return notes;
}

/** Positions of each character of `text` in `alphabet`, skipping others. */
function parseLetters(text: string, alphabet: string): I32[] {
  const values: I32[] = [];
  const letters = codePoints(alphabet);
  for (const code of codePoints(text)) {
    const c = lower(code);
    for (let i = 0; i < len(letters); i++) if (letters[i] === c) push(values, i);
  }
  return values;
}

function lower(code: I32): I32 {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

// ---- Playback ------------------------------------------------------------

export function play(ch: I32, sounds: I32[], loop: boolean, resume: boolean): void {
  if (ch < 0 || ch >= NUM_CHANNELS || len(sounds) === 0) return;
  if (resume && chPlaying[ch]) return;
  chSounds[ch] = sounds;
  chLoop[ch] = loop;
  chSound[ch] = 0;
  chNote[ch] = 0;
  chTick[ch] = 0;
  chPlayback[ch] = 0;
  chPlaying[ch] = true;
}

export function playMusic(n: I32, loop: boolean): void {
  if (n < 0 || n >= NUM_MUSICS) return;
  for (let c = 0; c < NUM_CHANNELS; c++) {
    if (len(musicSeqs[n * NUM_CHANNELS + c]) > 0) play(c, musicSeqs[n * NUM_CHANNELS + c], loop, false);
    else stop(c);
  }
}

export function stop(ch: I32): void {
  if (ch < 0 || ch >= NUM_CHANNELS) return;
  chPlaying[ch] = false;
  chLastPitch[ch] = -1;
}

export function isPlaying(ch: I32): boolean {
  return ch >= 0 && ch < NUM_CHANNELS && chPlaying[ch];
}

/** The sound number playing on a channel, or -1. */
export function playingSound(ch: I32): I32 {
  if (!isPlaying(ch)) return -1;
  return chSounds[ch][chSound[ch]];
}

/** The position in the playing sound, in notes. */
export function playingNote(ch: I32): I32 {
  return isPlaying(ch) ? chNote[ch] : -1;
}

// ---- Ticks ---------------------------------------------------------------

/** Advances every channel by `ticks` audio ticks and emits their voices. */
export function advance(ticks: I32): void {
  for (let t = 0; t < ticks; t++) for (let c = 0; c < NUM_CHANNELS; c++) tickChannel(c);
}

// A note's tone, volume and effect cycle through their lists, as in sound.rs.
function toneAt(n: I32, index: I32): I32 {
  const count = len(soundTones[n]);
  return count === 0 ? TONE_TRIANGLE : soundTones[n][index % count];
}

function volumeAt(n: I32, index: I32): I32 {
  const count = len(soundVolumes[n]);
  return count === 0 ? MAX_VOLUME : soundVolumes[n][index % count];
}

function effectAt(n: I32, index: I32): I32 {
  const count = len(soundEffects[n]);
  return count === 0 ? EFFECT_NONE : soundEffects[n][index % count];
}

/** Emits channel c's voice for this tick, then moves it one tick forward. */
function tickChannel(c: I32): void {
  if (!chPlaying[c]) {
    pushVoice(-1, 0, 0);
    return;
  }
  // Skip empty sounds, as a channel with nothing to play stops.
  let guard = 0;
  while (len(soundNotes[chSounds[c][chSound[c]]]) === 0) {
    if (!nextSound(c) || guard > len(chSounds[c])) {
      chPlaying[c] = false;
      pushVoice(-1, 0, 0);
      return;
    }
    guard++;
  }
  const n = chSounds[c][chSound[c]];
  const speed = soundSpeeds[n],
    index = chNote[c],
    tick = chTick[c];
  const note = soundNotes[n][index];
  if (note < 0) {
    pushVoice(-1, 0, 0);
  } else {
    const tone = toneAt(n, index) & 3;
    const volume = volumeAt(n, index);
    const effect = effectAt(n, index);
    const pitch = (note + (tone === TONE_NOISE ? 60 : 36)) * 64;
    if (tick === 0) {
      chGlide[c] = effect === EFFECT_SLIDE && chLastPitch[c] >= 0 ? chLastPitch[c] - pitch : 0;
      chLastPitch[c] = pitch;
    }
    let current = pitch;
    if (effect === EFFECT_SLIDE) current += idivRound(chGlide[c] * (speed - tick), speed);
    if (effect === EFFECT_VIBRATO) current += vibrato(chPlayback[c]);
    pushVoice(
      tone,
      step(current, tone),
      idiv(TONE_AMP[tone] * volume * envelope(effect, tick, speed), MAX_VOLUME * 256),
    );
  }
  chTick[c] = tick + 1;
  chPlayback[c]++;
  if (chTick[c] >= speed) {
    chTick[c] = 0;
    chNote[c] = index + 1;
    if (chNote[c] >= len(soundNotes[n])) {
      chNote[c] = 0;
      if (!nextSound(c)) chPlaying[c] = false;
    }
  }
}

/** Moves to the next sound of the channel's list; false when the list ended without looping. */
function nextSound(c: I32): boolean {
  chSound[c]++;
  chNote[c] = 0;
  if (chSound[c] < len(chSounds[c])) return true;
  chSound[c] = 0;
  return chLoop[c];
}

/** Integer division rounded half away from zero. */
function idivRound(value: I32, by: I32): I32 {
  return value >= 0 ? idiv(value + (by >> 1), by) : -idiv(-value + (by >> 1), by);
}

/** Pitch offset in 1/64 semitones: a triangle of ±16 over VIBRATO_PERIOD ticks. */
function vibrato(ticks: I32): I32 {
  // modulation = 1 - 4 |fract(phase + 1/4) - 1/2|, phase = ticks / period.
  const at = (ticks + (VIBRATO_PERIOD >> 2)) % VIBRATO_PERIOD;
  const distance = at * 2 - VIBRATO_PERIOD;
  const magnitude = distance < 0 ? -distance : distance;
  return idiv(16 * (VIBRATO_PERIOD - 2 * magnitude), VIBRATO_PERIOD);
}

/** Volume envelope in 1/256 for a tick of a note. */
function envelope(effect: I32, tick: I32, speed: I32): I32 {
  if (effect === EFFECT_FADEOUT) return idiv(256 * (speed - tick), speed);
  if (effect === EFFECT_HALF_FADEOUT || effect === EFFECT_QUARTER_FADEOUT) {
    // round(speed / 2) and round(speed / 4), halves away from zero.
    const fade = effect === EFFECT_HALF_FADEOUT ? idiv(speed + 1, 2) : idiv(speed + 2, 4);
    if (tick < speed - fade || fade <= 0) return 256;
    return idiv(256 * (speed - tick), fade);
  }
  return 256;
}

/** Phase step for a pitch in 1/64 semitones, interpolating the note table. */
function step(pitch: I32, tone: I32): I32 {
  const note = pitch >> 6;
  if (note < 0) return noteSteps[0];
  if (note >= 128) return noteSteps[128];
  const low = noteSteps[note],
    high = noteSteps[note + 1];
  const value = low + idiv((high - low) * (pitch & 63), 64);
  // Noise advances its shift register once per waveform period, not 32 times.
  return tone === TONE_NOISE ? value >> 5 : value;
}
