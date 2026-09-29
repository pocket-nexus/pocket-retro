//! Text output through the mGBA debug registers, and frame statistics.
//!
//! On hardware without these registers the writes go to unmapped I/O and have
//! no effect. tools/emu reads the lines back from the emulator log.

use core::fmt::Write;
use core::ptr::{read_volatile, write_volatile};

const DEBUG_ENABLE: usize = 0x04ff_f780;
const DEBUG_FLAGS: usize = 0x04ff_f700;
const DEBUG_STRING: usize = 0x04ff_f600;
const CAPACITY: usize = 255;

#[derive(Clone, Copy)]
pub enum Level {
    Fatal = 0,
    Error = 1,
    Warn = 2,
    Info = 3,
}

fn enabled() -> bool {
    unsafe {
        if read_volatile(DEBUG_ENABLE as *const u16) != 0x1dea {
            write_volatile(DEBUG_ENABLE as *mut u16, 0xc0de);
        }
        read_volatile(DEBUG_ENABLE as *const u16) == 0x1dea
    }
}

/// One console line of at most 255 bytes; longer text is cut.
pub struct Line {
    level: Level,
    buffer: [u8; CAPACITY],
    length: usize,
}

impl Line {
    pub fn new(level: Level) -> Self {
        Self {
            level,
            buffer: [0; CAPACITY],
            length: 0,
        }
    }

    pub fn flush(&mut self) {
        if !enabled() {
            return;
        }
        unsafe {
            for (i, byte) in self.buffer[..self.length].iter().enumerate() {
                write_volatile((DEBUG_STRING + i) as *mut u8, *byte);
            }
            write_volatile((DEBUG_STRING + self.length) as *mut u8, 0);
            write_volatile(DEBUG_FLAGS as *mut u16, 0x100 | self.level as u16);
        }
        self.length = 0;
    }
}

impl Write for Line {
    fn write_str(&mut self, text: &str) -> core::fmt::Result {
        let room = CAPACITY - self.length;
        let bytes = &text.as_bytes()[..text.len().min(room)];
        self.buffer[self.length..self.length + bytes.len()].copy_from_slice(bytes);
        self.length += bytes.len();
        Ok(())
    }
}

/// Prints one formatted line at info level.
#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => {{
        use core::fmt::Write as _;
        let mut line = $crate::debug::Line::new($crate::debug::Level::Info);
        let _ = write!(line, $($arg)*);
        line.flush();
    }};
}

/// Reports frame cost once per second of target frames:
/// `stats frames=… game=avg/max present=avg late=… heap=used/peak/size stack=…`.
pub struct Stats {
    period: u32,
    frames: u32,
    total: u32,
    game: u32,
    game_max: u32,
    present: u32,
    late: u32,
}

impl Stats {
    pub fn new(fps: u32) -> Self {
        Self {
            period: fps.max(1),
            frames: 0,
            total: 0,
            game: 0,
            game_max: 0,
            present: 0,
            late: 0,
        }
    }

    pub fn record(&mut self, game: u32, present: u32, late: bool) {
        self.frames += 1;
        self.total += 1;
        self.game += game;
        self.game_max = self.game_max.max(game);
        self.present += present;
        self.late += late as u32;
        if self.frames < self.period {
            return;
        }
        crate::log!(
            "stats frames={} game={}/{} present={} late={} heap={}/{}/{} iwram={}/{} stack={}",
            self.total,
            self.game / self.frames,
            self.game_max,
            self.present / self.frames,
            self.late,
            crate::memory::heap_used(),
            crate::memory::heap_peak(),
            crate::memory::heap_size(),
            crate::memory::iwram_heap().0,
            crate::memory::iwram_heap().1,
            crate::memory::stack_used()
        );
        *self = Self {
            total: self.total,
            ..Self::new(self.period)
        };
    }
}
