/* Cartridge ROM, 256 KiB of external work RAM (EWRAM) and internal work RAM
   (IWRAM). IWRAM holds `.iwram` code and data, then a second heap up to
   __stack_limit, then 5 KiB of system stack below 0x03007F00, then the IRQ
   stack and the BIOS area. */
ENTRY(_start)
MEMORY {
  ROM (rx) : ORIGIN = 0x08000000, LENGTH = 32M
  EWRAM (rwx) : ORIGIN = 0x02000000, LENGTH = 256K
  IWRAM (rwx) : ORIGIN = 0x03000000, LENGTH = 0x6b00
}
SECTIONS {
  .text : { KEEP(*(.gba.header)) *(.text .text.*) *(.rodata .rodata.*) } > ROM
  .ARM.exidx : { *(.ARM.exidx*) } > ROM
  .iwram : ALIGN(4) { __iwram_start = .; *(.iwram .iwram.*) . = ALIGN(4); __iwram_end = .; } > IWRAM AT>ROM
  __iwram_load = LOADADDR(.iwram);
  .iwram_bss (NOLOAD) : ALIGN(4) { __iwram_bss_start = .; *(.iwram_bss .iwram_bss.*) . = ALIGN(4); __iwram_bss_end = .; } > IWRAM
  .data : ALIGN(4) { __data_start = .; *(.data .data.*) . = ALIGN(4); __data_end = .; } > EWRAM AT>ROM
  __data_load = LOADADDR(.data);
  .bss (NOLOAD) : ALIGN(8) { __bss_start = .; *(.bss .bss.*) *(COMMON) . = ALIGN(8); __bss_end = .; } > EWRAM
  __heap_start = __bss_end;
  __iwram_heap_start = __iwram_bss_end;
  __stack_limit = ORIGIN(IWRAM) + LENGTH(IWRAM);
  __heap_end = ORIGIN(EWRAM) + LENGTH(EWRAM);
  /DISCARD/ : { *(.ARM.attributes) *(.comment) }
}
