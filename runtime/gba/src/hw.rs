//! Memory-mapped registers, DMA, timers, keypad and BIOS calls.
//! Register layouts follow GBATEK.

use core::ptr::{read_volatile, write_volatile};

pub const DISPCNT: usize = 0x0400_0000;
pub const DISPSTAT: usize = 0x0400_0004;
pub const KEYINPUT: usize = 0x0400_0130;
pub const IE: usize = 0x0400_0200;
pub const WAITCNT: usize = 0x0400_0204;
pub const IME: usize = 0x0400_0208;
pub const TM2CNT_L: usize = 0x0400_0108;
pub const TM2CNT_H: usize = 0x0400_010a;
pub const TM3CNT_L: usize = 0x0400_010c;
pub const TM3CNT_H: usize = 0x0400_010e;
pub const DMA3SAD: usize = 0x0400_00d4;
pub const DMA3DAD: usize = 0x0400_00d8;
pub const DMA3CNT_L: usize = 0x0400_00dc;
pub const DMA3CNT_H: usize = 0x0400_00de;

pub const DISPCNT_FORCED_BLANK: u16 = 1 << 7;
pub const DISPSTAT_VBLANK_IRQ: u16 = 1 << 3;
pub const IRQ_VBLANK: u32 = 1 << 0;

const DMA_ENABLE: u16 = 1 << 15;
const DMA_32BIT: u16 = 1 << 10;
const DMA_SOURCE_FIXED: u16 = 2 << 7;

#[inline(always)]
pub unsafe fn write16(address: usize, value: u16) {
    write_volatile(address as *mut u16, value);
}

#[inline(always)]
pub unsafe fn read16(address: usize) -> u16 {
    read_volatile(address as *const u16)
}

/// Pressed keys as KEYINPUT bits: A, B, Select, Start, Right, Left, Up, Down, R, L.
pub fn keys() -> u32 {
    unsafe { !read16(KEYINPUT) as u32 & 0x3ff }
}

/// Timers 2 and 3 cascade into a free-running 32-bit CPU cycle counter.
pub fn start_cycle_counter() {
    unsafe {
        write16(TM2CNT_H, 0);
        write16(TM3CNT_H, 0);
        write16(TM2CNT_L, 0);
        write16(TM3CNT_L, 0);
        write16(TM3CNT_H, 0x0084);
        write16(TM2CNT_H, 0x0080);
    }
}

pub fn cycles() -> u32 {
    unsafe {
        loop {
            let high = read16(TM3CNT_L) as u32;
            let low = read16(TM2CNT_L) as u32;
            if high == read16(TM3CNT_L) as u32 {
                return (high << 16) | low;
            }
        }
    }
}

/// Halts the CPU until the next VBlank interrupt (BIOS VBlankIntrWait).
pub fn wait_vblank() {
    unsafe {
        core::arch::asm!("swi 0x05", out("r0") _, out("r1") _, out("r2") _, out("r3") _, out("r12") _);
    }
}

/// Copies `words` 32-bit words with DMA 3. Both addresses must be word aligned.
pub unsafe fn dma_copy32(source: *const u32, destination: *mut u32, words: usize) {
    if words == 0 {
        return;
    }
    write_volatile(DMA3SAD as *mut u32, source as u32);
    write_volatile(DMA3DAD as *mut u32, destination as u32);
    write16(DMA3CNT_L, words as u16);
    write16(DMA3CNT_H, DMA_ENABLE | DMA_32BIT);
}

/// Source word for fills. DMA reads memory the compiler does not see, so the
/// value goes through a volatile store to a static rather than a local.
static mut FILL_SOURCE: u32 = 0;

/// Fills `words` 32-bit words with `value` using DMA 3.
pub unsafe fn dma_fill32(value: u32, destination: *mut u32, words: usize) {
    if words == 0 {
        return;
    }
    let source = core::ptr::addr_of_mut!(FILL_SOURCE);
    write_volatile(source, value);
    write_volatile(DMA3SAD as *mut u32, source as u32);
    write_volatile(DMA3DAD as *mut u32, destination as u32);
    write16(DMA3CNT_L, words as u16);
    write16(DMA3CNT_H, DMA_ENABLE | DMA_32BIT | DMA_SOURCE_FIXED);
}
