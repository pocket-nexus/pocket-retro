//! Game Boy Advance host for Pocket Pyxel.
//!
//! A game crate compiled by MicroTS implements [`Game`] and calls [`run`] from
//! `pyxel_game_main`. The host owns the hardware: it boots the cartridge,
//! paces frames on VBlank, samples the keypad, presents the game's indexed
//! frame buffer through Mode 4 and its palette, and reports measurements
//! through the mGBA debug console.
#![no_std]
#![feature(alloc_error_handler)]

extern crate alloc;

pub mod audio;
pub mod debug;
pub mod hw;
pub mod memory;
pub mod video;

use core::ptr::{read_volatile, write_volatile};

core::arch::global_asm!(include_str!("start.s"), options(raw));

/// An indexed frame buffer: one palette index per pixel, row-major.
pub struct Screen<'a> {
    pub pixels: &'a [u8],
    pub width: usize,
    pub height: usize,
}

/// The interface between the host and a compiled game model.
pub trait Game {
    /// Runs once before the first frame.
    fn boot(&mut self);
    /// Advances one frame. `keys` holds the pressed keys as KEYINPUT bits
    /// (1 = pressed); `ticks` counts the VBlanks since the previous frame.
    fn frame(&mut self, keys: u32, ticks: u32);
    fn screen(&self) -> Screen<'_>;
    /// The screen's storage, which the host moves into IWRAM when it fits.
    fn screen_buffer(&mut self) -> &mut alloc::vec::Vec<u8>;
    /// Display colors as 0xRRGGBB, indexed by palette entry.
    fn colors(&self) -> &[i32];
    /// Target frame rate in frames per second.
    fn fps(&self) -> u32;
    /// Voice records the sequencer produced during the frame; the host drains them.
    fn voices(&mut self) -> &mut alloc::vec::Vec<i32>;
}

static mut VBLANKS: u32 = 0;

/// VBlanks since boot, counted by the IRQ handler.
pub fn vblanks() -> u32 {
    unsafe { read_volatile(core::ptr::addr_of!(VBLANKS)) }
}

#[no_mangle]
extern "C" fn pyxel_irq_rust(flags: u32) {
    if flags & hw::IRQ_VBLANK != 0 {
        unsafe { write_volatile(core::ptr::addr_of_mut!(VBLANKS), vblanks().wrapping_add(1)) };
        audio::vblank();
    }
}

extern "C" {
    fn pyxel_game_main() -> !;
    fn pyxel_irq();
}

#[no_mangle]
unsafe extern "C" fn pyxel_main() -> ! {
    memory::init_heap();
    hw::write16(hw::DISPCNT, hw::DISPCNT_FORCED_BLANK);
    // ROM wait states 3/1 with the prefetch buffer, as commercial cartridges use.
    hw::write16(hw::WAITCNT, 0x4317);
    write_volatile(0x0300_7ffc as *mut usize, pyxel_irq as *const () as usize);
    hw::write16(hw::DISPSTAT, hw::DISPSTAT_VBLANK_IRQ);
    hw::write16(hw::IE, hw::IRQ_VBLANK as u16);
    hw::write16(hw::IME, 1);
    hw::start_cycle_counter();
    pyxel_game_main()
}

/// Runs the game forever: one `frame` per 60 / fps VBlanks.
pub fn run<G: Game>(game: &mut G) -> ! {
    game.boot();
    memory::move_to_iwram(game.screen_buffer());
    game.voices().clear();
    let mut display = video::Display::new();
    audio::start();
    let vblanks_per_frame = (60 / game.fps().clamp(1, 60)).max(1);
    let mut stats = debug::Stats::new(game.fps());
    let mut deadline = vblanks() + vblanks_per_frame;
    loop {
        let begin = hw::cycles();
        // Audio ticks to produce: enough to keep TARGET_TICKS queued for the mixer.
        let audio_ticks = audio::TARGET_TICKS.saturating_sub(audio::queued());
        game.frame(hw::keys(), audio_ticks);
        let computed = hw::cycles();
        audio::push(game.voices());
        game.voices().clear();
        memory::move_to_iwram(game.screen_buffer());
        display.draw(&game.screen());
        let drawn = hw::cycles();
        let late = (vblanks().wrapping_sub(deadline) as i32) >= 0;
        while (vblanks().wrapping_sub(deadline) as i32) < 0 {
            hw::wait_vblank();
        }
        display.flip();
        display.set_colors(game.colors());
        deadline = if late {
            vblanks() + vblanks_per_frame
        } else {
            deadline + vblanks_per_frame
        };
        stats.record(computed.wrapping_sub(begin), drawn.wrapping_sub(computed), late);
    }
}

fn halt_with_red_screen() -> ! {
    unsafe {
        hw::write16(hw::IME, 0);
        hw::write16(hw::DISPCNT, 0);
        write_volatile(0x0500_0000 as *mut u16, 0x001f);
    }
    loop {
        core::hint::spin_loop();
    }
}

#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    use core::fmt::Write;
    let mut line = debug::Line::new(debug::Level::Fatal);
    let _ = write!(line, "panic: {}", info.message());
    if let Some(location) = info.location() {
        let _ = write!(line, " at {}:{}", location.file(), location.line());
    }
    line.flush();
    halt_with_red_screen()
}

#[alloc_error_handler]
fn out_of_memory(layout: core::alloc::Layout) -> ! {
    use core::fmt::Write;
    let mut line = debug::Line::new(debug::Level::Fatal);
    let _ = write!(
        line,
        "out of memory: {} bytes requested, {} in use",
        layout.size(),
        memory::heap_used()
    );
    line.flush();
    halt_with_red_screen()
}
