//! Mode 4 presentation of an indexed frame buffer.
//!
//! Mode 4 shows a 240 x 160 page of 8-bit palette indices from BG2 through
//! the 256-entry BG palette, which matches Pyxel's indexed screen. Two pages
//! alternate: the host copies a frame into the hidden page, then flips pages
//! during VBlank. A screen smaller than 240 x 160 is centered; pixels outside
//! it use palette entry 0.

use crate::hw;
use crate::Screen;

const PAGE_BYTES: usize = 0xa000;
const VRAM: usize = 0x0600_0000;
const PALETTE: usize = 0x0500_0000;
const WIDTH: usize = 240;
const HEIGHT: usize = 160;
const MODE4: u16 = 4;
const BG2: u16 = 1 << 10;
const PAGE1: u16 = 1 << 4;

pub struct Display {
    /// The page not shown, which the next frame is copied into.
    back: usize,
    colors: [u16; 256],
    color_count: usize,
}

impl Display {
    pub fn new() -> Self {
        unsafe {
            hw::dma_fill32(0, VRAM as *mut u32, PAGE_BYTES * 2 / 4);
            hw::write16(hw::DISPCNT, MODE4 | BG2);
        }
        Self {
            back: 1,
            colors: [0; 256],
            color_count: 0,
        }
    }

    /// Copies a frame into the hidden page.
    pub fn draw(&mut self, screen: &Screen) {
        let width = screen.width.min(WIDTH);
        let height = screen.height.min(HEIGHT).min(screen.pixels.len() / screen.width.max(1));
        let left = (WIDTH - width) / 2 & !3;
        let top = (HEIGHT - height) / 2;
        let page = VRAM + self.back * PAGE_BYTES;
        let source = screen.pixels.as_ptr() as usize;
        for y in 0..height {
            let from = source + y * screen.width;
            let to = page + (top + y) * WIDTH + left;
            unsafe {
                if from % 4 == 0 && width % 4 == 0 {
                    hw::dma_copy32(from as *const u32, to as *mut u32, width / 4);
                } else {
                    copy_row_unaligned(from as *const u8, to as *mut u16, width);
                }
            }
        }
    }

    /// Shows the page drawn last. Call during VBlank.
    pub fn flip(&mut self) {
        unsafe { hw::write16(hw::DISPCNT, MODE4 | BG2 | if self.back == 1 { PAGE1 } else { 0 }) };
        self.back ^= 1;
    }

    /// Loads changed display colors into the BG palette. Call during VBlank.
    pub fn set_colors(&mut self, colors: &[i32]) {
        let count = colors.len().min(256);
        for (index, &rgb) in colors[..count].iter().enumerate() {
            let color = bgr555(rgb);
            if index >= self.color_count || self.colors[index] != color {
                self.colors[index] = color;
                unsafe { hw::write16(PALETTE + index * 2, color) };
            }
        }
        self.color_count = count;
    }
}

/// VRAM takes 16-bit writes only, so bytes are paired before storing.
unsafe fn copy_row_unaligned(from: *const u8, to: *mut u16, width: usize) {
    for pair in 0..width / 2 {
        let low = *from.add(pair * 2) as u16;
        let high = *from.add(pair * 2 + 1) as u16;
        core::ptr::write_volatile(to.add(pair), low | high << 8);
    }
    if width % 2 == 1 {
        let last = to.add(width / 2);
        let kept = core::ptr::read_volatile(last) & 0xff00;
        core::ptr::write_volatile(last, kept | *from.add(width - 1) as u16);
    }
}

fn bgr555(rgb: i32) -> u16 {
    let r = (rgb >> 19) & 31;
    let g = (rgb >> 11) & 31;
    let b = (rgb >> 3) & 31;
    (r | g << 5 | b << 10) as u16
}
