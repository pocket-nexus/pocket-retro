//! Heap in external work RAM and the critical section used by MicroTS atomics.

use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;
use core::ptr::{addr_of, addr_of_mut, read_volatile, NonNull};
use linked_list_allocator::Heap;

use crate::hw;

/// Two heaps: external work RAM, and the internal work RAM left between the
/// `.iwram` sections and the stack. IWRAM has a 32-bit bus without wait
/// states; blocks go there only inside `in_iwram`, which the host uses to
/// move the screen. Only the main loop allocates.
struct Allocator {
    ewram: UnsafeCell<Heap>,
    iwram: UnsafeCell<Heap>,
}
unsafe impl Sync for Allocator {}

/// Largest block placed in IWRAM; 0 outside `in_iwram`.
static mut IWRAM_BLOCKS: usize = 0;
/// IWRAM heap bytes in use beyond which no block is placed there.
static mut IWRAM_BUDGET: usize = 0;

unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.size() <= IWRAM_BLOCKS && (*self.iwram.get()).used() + layout.size() <= IWRAM_BUDGET {
            if let Ok(block) = (*self.iwram.get()).allocate_first_fit(layout) {
                return block.as_ptr();
            }
        }
        let ewram = &mut *self.ewram.get();
        let result = ewram
            .allocate_first_fit(layout)
            .map_or(core::ptr::null_mut(), |p| p.as_ptr());
        PEAK = PEAK.max(ewram.used());
        result
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        let heap = if is_iwram(ptr) {
            &mut *self.iwram.get()
        } else {
            &mut *self.ewram.get()
        };
        heap.deallocate(NonNull::new_unchecked(ptr), layout);
    }
}

/// Whether a pointer is in internal work RAM.
pub fn is_iwram(ptr: *const u8) -> bool {
    (0x0300_0000..0x0300_8000).contains(&(ptr as usize))
}

/// Runs `f` with allocations placed in IWRAM while they fit.
pub fn in_iwram<T>(f: impl FnOnce() -> T) -> T {
    in_iwram_up_to(usize::MAX, usize::MAX, f)
}

/// Runs `f` with allocations of at most `size` bytes placed in IWRAM while
/// the IWRAM heap stays within `budget` bytes.
pub fn in_iwram_up_to<T>(size: usize, budget: usize, f: impl FnOnce() -> T) -> T {
    unsafe {
        IWRAM_BLOCKS = size;
        IWRAM_BUDGET = budget;
    }
    let result = f();
    unsafe { IWRAM_BLOCKS = 0 };
    result
}

/// Moves a buffer into IWRAM if it is elsewhere and fits.
pub fn move_to_iwram(buffer: &mut alloc::vec::Vec<u8>) {
    if buffer.is_empty() || is_iwram(buffer.as_ptr()) {
        return;
    }
    let (used, size) = iwram_heap();
    if buffer.len() + 64 > size - used {
        return;
    }
    let moved = in_iwram(|| buffer.clone());
    if is_iwram(moved.as_ptr()) {
        *buffer = moved;
    }
}

/// Runs the copies between buffers of different word alignment and the
/// backward moves (block_copy_shifted and block_move_shifted in start.s)
/// from a copy in IWRAM, where they run two to three times as fast as from
/// ROM, if the IWRAM heap has room for it. The host calls it once the
/// screen has its place.
pub fn place_shifted_copies() {
    extern "C" {
        static retro_shifted_start: u8;
        static retro_shifted_end: u8;
        static block_copy_shifted: u8;
        static block_move_shifted: u8;
        static mut retro_copy_shifted_entry: usize;
        static mut retro_move_shifted_entry: usize;
    }
    unsafe {
        let start = addr_of!(retro_shifted_start) as usize;
        let size = addr_of!(retro_shifted_end) as usize - start;
        let mut code: alloc::vec::Vec<u32> = in_iwram(|| alloc::vec![0; size.div_ceil(4)]);
        if !is_iwram(code.as_ptr() as *const u8) {
            return;
        }
        core::ptr::copy_nonoverlapping(start as *const u8, code.as_mut_ptr() as *mut u8, size);
        let base = code.as_ptr() as usize;
        core::ptr::write_volatile(
            addr_of_mut!(retro_copy_shifted_entry),
            base + addr_of!(block_copy_shifted) as usize - start,
        );
        core::ptr::write_volatile(
            addr_of_mut!(retro_move_shifted_entry),
            base + addr_of!(block_move_shifted) as usize - start,
        );
        core::mem::forget(code);
    }
}

#[global_allocator]
static ALLOCATOR: Allocator = Allocator {
    ewram: UnsafeCell::new(Heap::empty()),
    iwram: UnsafeCell::new(Heap::empty()),
};
static mut PEAK: usize = 0;

pub(crate) unsafe fn init_heap() {
    extern "C" {
        static mut __heap_start: u8;
        static mut __heap_end: u8;
        static mut __iwram_heap_start: u8;
        static mut __stack_limit: u8;
    }
    let start = addr_of_mut!(__heap_start);
    (*ALLOCATOR.ewram.get()).init(start, addr_of_mut!(__heap_end) as usize - start as usize);
    let start = addr_of_mut!(__iwram_heap_start);
    (*ALLOCATOR.iwram.get()).init(start, addr_of_mut!(__stack_limit) as usize - start as usize);
}

/// EWRAM heap bytes in use.
pub fn heap_used() -> usize {
    unsafe { (*ALLOCATOR.ewram.get()).used() }
}

pub fn heap_peak() -> usize {
    unsafe { PEAK }
}

pub fn heap_size() -> usize {
    unsafe { (*ALLOCATOR.ewram.get()).size() }
}

/// IWRAM heap bytes in use and available in total.
pub fn iwram_heap() -> (usize, usize) {
    unsafe { ((*ALLOCATOR.iwram.get()).used(), (*ALLOCATOR.iwram.get()).size()) }
}

/// Deepest system stack use so far, found from the paint written by start.s.
pub fn stack_used() -> usize {
    extern "C" {
        static __stack_limit: u8;
    }
    const TOP: usize = 0x0300_7f00;
    let mut low = core::ptr::addr_of!(__stack_limit) as usize;
    while low < TOP && unsafe { read_volatile(low as *const u32) } == 0xdead_beef {
        low += 4;
    }
    TOP - low
}

struct GbaCriticalSection;
critical_section::set_impl!(GbaCriticalSection);
unsafe impl critical_section::Impl for GbaCriticalSection {
    unsafe fn acquire() -> bool {
        let enabled = hw::read16(hw::IME) != 0;
        hw::write16(hw::IME, 0);
        core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
        enabled
    }
    unsafe fn release(enabled: bool) {
        core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
        hw::write16(hw::IME, enabled as u16);
    }
}
