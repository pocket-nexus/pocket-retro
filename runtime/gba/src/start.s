@ Cartridge entry, RAM initialisation and the IRQ trampoline.
.syntax unified

.section .gba.header,"ax"
.arm
.global _start
.type _start, %function
_start:
    b reset
    @ Logo, title, codes and checksum are written by tools/lib/rom.ts.
    .space 188
reset:
    @ IRQ mode stack below the BIOS area, system mode stack below it.
    mov r0, #0x92
    msr cpsr_c, r0
    ldr sp, =0x03007fa0
    @ IRQs stay off until the runtime sets IE and IME.
    mov r0, #0x1f
    msr cpsr_c, r0
    ldr sp, =0x03007f00
    @ Paint the system stack so the runtime can measure its depth.
    ldr r0, =__stack_limit
    ldr r1, =0xdeadbeef
0:  cmp r0, sp
    strlo r1, [r0], #4
    blo 0b
    ldr r0, =__iwram_load
    ldr r1, =__iwram_start
    ldr r2, =__iwram_end
    bl boot_copy
    ldr r0, =__data_load
    ldr r1, =__data_start
    ldr r2, =__data_end
    bl boot_copy
    ldr r1, =__bss_start
    ldr r2, =__bss_end
    bl boot_zero
    ldr r1, =__iwram_bss_start
    ldr r2, =__iwram_bss_end
    bl boot_zero
    @ Enter Rust in system mode.
    ldr r0, =retro_main
    bx r0
    @ mGBA loads a ROM under 256 KiB as a multiboot image when the words
    @ after its header name EWRAM (as __data_start does above) but not the
    @ first 128 KiB of ROM, where retro_main may not lie. Name the ROM here.
    .word _start, _start

boot_copy:
    cmp r1, r2
    ldrlo r3, [r0], #4
    strlo r3, [r1], #4
    blo boot_copy
    bx lr

boot_zero:
    mov r3, #0
1:  cmp r1, r2
    strlo r3, [r1], #4
    blo 1b
    bx lr

@ The BIOS saves r0-r3, r12 and lr, then calls this in ARM IRQ mode.
.section .iwram.irq,"ax"
.arm
.global retro_irq
.type retro_irq, %function
retro_irq:
    ldr r0, =0x04000200
    ldr r1, [r0]
    and r1, r1, r1, lsr #16
    strh r1, [r0, #2]
    ldr r2, =0x03007ff8
    ldrh r3, [r2]
    orr r3, r3, r1
    strh r3, [r2]
    @ Run the handler on the system stack with IRQs masked.
    mrs r2, spsr
    stmfd sp!, {r2, lr}
    mov r2, #0x9f
    msr cpsr_c, r2
    stmfd sp!, {r0, lr}
    mov r0, r1
    ldr r3, =retro_irq_rust
    mov lr, pc
    bx r3
    ldmfd sp!, {r0, lr}
    mov r2, #0x92
    msr cpsr_c, r2
    ldmfd sp!, {r2, lr}
    msr spsr_cxsf, r2
    bx lr

@ ARM7TDMI has no cache or write buffer; the compiler barrier is enough.
.text
.global __sync_synchronize
.type __sync_synchronize, %function
__sync_synchronize:
    bx lr

@ Memory intrinsics in ARM code from IWRAM. They replace the weak Thumb
@ versions in compiler_builtins; word-aligned runs move 32 bytes per
@ ldmia/stmia pair. Callers never pass VRAM, which rejects byte stores.
.section .iwram.mem,"ax"
.arm
.align 2
.global memset
.type memset, %function
memset:
    mov r3, r1
    mov r1, r2
    mov r2, r3
    push {r0, lr}
    bl retro_fill
    pop {r0, lr}
    bx lr

.global __aeabi_memset
.global __aeabi_memset4
.global __aeabi_memset8
.type __aeabi_memset, %function
.type __aeabi_memset4, %function
.type __aeabi_memset8, %function
__aeabi_memset:
__aeabi_memset4:
__aeabi_memset8:
    b retro_fill

.global __aeabi_memclr
.global __aeabi_memclr4
.global __aeabi_memclr8
.type __aeabi_memclr, %function
.type __aeabi_memclr4, %function
.type __aeabi_memclr8, %function
__aeabi_memclr:
__aeabi_memclr4:
__aeabi_memclr8:
    mov r2, #0
    b retro_fill

@ r0 = destination, r1 = byte count, r2 = byte value
retro_fill:
    and r2, r2, #0xff
    orr r2, r2, r2, lsl #8
    orr r2, r2, r2, lsl #16
fill_align:
    cmp r1, #0
    bxeq lr
    tst r0, #3
    beq fill_words
    strb r2, [r0], #1
    sub r1, r1, #1
    b fill_align
fill_words:
    push {r4-r9}
    mov r3, r2
    mov r4, r2
    mov r5, r2
    mov r6, r2
    mov r7, r2
    mov r8, r2
    mov r9, r2
fill_blocks:
    cmp r1, #32
    blo fill_restore
    stmia r0!, {r2-r9}
    sub r1, r1, #32
    b fill_blocks
fill_restore:
    pop {r4-r9}
fill_word:
    cmp r1, #4
    blo fill_bytes
    str r2, [r0], #4
    sub r1, r1, #4
    b fill_word
fill_bytes:
    cmp r1, #0
    bxeq lr
    strb r2, [r0], #1
    sub r1, r1, #1
    b fill_bytes

.global memcpy
.type memcpy, %function
memcpy:
    push {r0, lr}
    bl retro_copy
    pop {r0, lr}
    bx lr

.global __aeabi_memcpy
.global __aeabi_memcpy4
.global __aeabi_memcpy8
.type __aeabi_memcpy, %function
.type __aeabi_memcpy4, %function
.type __aeabi_memcpy8, %function
__aeabi_memcpy:
__aeabi_memcpy4:
__aeabi_memcpy8:
    b retro_copy

@ r0 = destination, r1 = source, r2 = byte count; copies forward.
retro_copy:
    eor r12, r0, r1
copy_align:
    cmp r2, #0
    bxeq lr
    tst r0, #3
    beq copy_aligned
    ldrb r3, [r1], #1
    strb r3, [r0], #1
    sub r2, r2, #1
    b copy_align
copy_aligned:
    tst r12, #3
    bne copy_shifted
    push {r4-r10}
copy_blocks:
    subs r2, r2, #32
    ldmhs r1!, {r3-r10}
    stmhs r0!, {r3-r10}
    bhs copy_blocks
    add r2, r2, #32
    pop {r4-r10}
copy_word:
    subs r2, r2, #4
    ldrhs r3, [r1], #4
    strhs r3, [r0], #4
    bhs copy_word
    add r2, r2, #4
copy_bytes:
    subs r2, r2, #1
    ldrbhs r3, [r1], #1
    strbhs r3, [r0], #1
    bhi copy_bytes
    bx lr

@ The destination is word aligned and the source is not: each word stored
@ joins parts of two aligned source words, which costs half as much as
@ copying bytes. Copies of 40 bytes or more take block_copy_shifted instead
@ once the host has placed it in IWRAM.
copy_shifted:
    cmp r2, #40
    ldrhs r12, retro_copy_shifted_entry
    cmphs r12, #0
    bxhi r12
    push {r4, r5}
    and r12, r1, #3
    bic r1, r1, #3
    mov r12, r12, lsl #3
    rsb r5, r12, #32
    ldr r3, [r1], #4
shifted_words:
    subs r2, r2, #4
    ldrhs r4, [r1], #4
    movhs r3, r3, lsr r12
    orrhs r3, r3, r4, lsl r5
    strhs r3, [r0], #4
    movhs r3, r4
    bhs shifted_words
    add r2, r2, #4
    @ The next source byte lies in the last word read, r5 / 8 bytes from its end.
    sub r1, r1, r5, lsr #3
    pop {r4, r5}
    b copy_bytes

.global memmove
.type memmove, %function
memmove:
    push {r0, lr}
    bl retro_move
    pop {r0, lr}
    bx lr

.global __aeabi_memmove
.global __aeabi_memmove4
.global __aeabi_memmove8
.type __aeabi_memmove, %function
.type __aeabi_memmove4, %function
.type __aeabi_memmove8, %function
__aeabi_memmove:
__aeabi_memmove4:
__aeabi_memmove8:
    b retro_move

@ Forward unless the destination starts inside the source.
retro_move:
    cmp r0, r1
    bls retro_copy
    add r3, r1, r2
    cmp r0, r3
    bhs retro_copy
    add r0, r0, r2
    add r1, r1, r2
    cmp r2, #40
    ldrhs r12, retro_move_shifted_entry
    bxhs r12
move_back:
    cmp r2, #0
    bxeq lr
    ldrb r3, [r1, #-1]!
    strb r3, [r0, #-1]!
    sub r2, r2, #1
    b move_back

@ Where block_copy_shifted and block_move_shifted run from: none (0) and ROM
@ at first, and the copy of them the host places in IWRAM when the screen
@ leaves room (memory.rs).
.global retro_copy_shifted_entry
.global retro_move_shifted_entry
retro_copy_shifted_entry:
    .word 0
retro_move_shifted_entry:
    .word block_move_shifted

@ Copies of 40 bytes or more between addresses of different word alignment,
@ and backward moves of 40 bytes or more, reached from copy_shifted and
@ retro_move: each destination word is shifted together from two aligned
@ source words, 32 bytes per ldm/stm pair. The first load reads up to 3
@ bytes outside the source, which is harmless outside I/O registers. They
@ sit in ROM, leaving IWRAM to the screen, and the host copies them to IWRAM
@ if room is left after placing the screen: they run from there two to
@ three times as fast. The code from retro_shifted_start to
@ retro_shifted_end therefore branches only relative to itself and uses no
@ literal pool.
.text
.arm
.align 2
.global retro_shifted_start
.global retro_shifted_end
.global block_copy_shifted
.global block_move_shifted
retro_shifted_start:

@ Forward. r0 = destination, r1 = source, r2 = byte count.
block_copy_shifted:
0:  tst r0, #3
    ldrbne r3, [r1], #1
    strbne r3, [r0], #1
    subne r2, r2, #1
    bne 0b
    push {r4-r11, lr}
    and r12, r1, #3
    bic r1, r1, #3
    mov r12, r12, lsl #3
    rsb lr, r12, #32
    ldr r3, [r1], #4
    mov r3, r3, lsr r12
1:  cmp r2, #36
    blo 2f
    ldmia r1!, {r4-r11}
    orr r3, r3, r4, lsl lr
    mov r4, r4, lsr r12
    orr r4, r4, r5, lsl lr
    mov r5, r5, lsr r12
    orr r5, r5, r6, lsl lr
    mov r6, r6, lsr r12
    orr r6, r6, r7, lsl lr
    mov r7, r7, lsr r12
    orr r7, r7, r8, lsl lr
    mov r8, r8, lsr r12
    orr r8, r8, r9, lsl lr
    mov r9, r9, lsr r12
    orr r9, r9, r10, lsl lr
    mov r10, r10, lsr r12
    orr r10, r10, r11, lsl lr
    stmia r0!, {r3-r10}
    mov r3, r11, lsr r12
    sub r2, r2, #32
    b 1b
2:  cmp r2, #8
    blo 3f
    ldr r4, [r1], #4
    orr r3, r3, r4, lsl lr
    str r3, [r0], #4
    mov r3, r4, lsr r12
    sub r2, r2, #4
    b 2b
    @ Back to the first source byte not copied, 4 - (source & 3) before r1.
3:  sub r1, r1, lr, lsr #3
    pop {r4-r11, lr}
4:  cmp r2, #0
    bxeq lr
    ldrb r3, [r1], #1
    strb r3, [r0], #1
    sub r2, r2, #1
    b 4b

@ Backward, for a destination above an overlapping source: r0 and r1 point
@ one past the ends, r2 = byte count. The mirror image of block_copy_shifted,
@ which also moves aligned runs, without shifts.
block_move_shifted:
0:  tst r0, #3
    ldrbne r3, [r1, #-1]!
    strbne r3, [r0, #-1]!
    subne r2, r2, #1
    bne 0b
    push {r4-r11, lr}
    ands r12, r1, #3
    bne 5f
6:  cmp r2, #32
    blo 7f
    ldmdb r1!, {r3-r10}
    stmdb r0!, {r3-r10}
    sub r2, r2, #32
    b 6b
5:  bic r1, r1, #3
    mov r12, r12, lsl #3
    rsb lr, r12, #32
    ldr r11, [r1]
1:  cmp r2, #36
    blo 2f
    ldmdb r1!, {r3-r10}
    mov r11, r11, lsl lr
    orr r11, r11, r10, lsr r12
    mov r10, r10, lsl lr
    orr r10, r10, r9, lsr r12
    mov r9, r9, lsl lr
    orr r9, r9, r8, lsr r12
    mov r8, r8, lsl lr
    orr r8, r8, r7, lsr r12
    mov r7, r7, lsl lr
    orr r7, r7, r6, lsr r12
    mov r6, r6, lsl lr
    orr r6, r6, r5, lsr r12
    mov r5, r5, lsl lr
    orr r5, r5, r4, lsr r12
    mov r4, r4, lsl lr
    orr r4, r4, r3, lsr r12
    stmdb r0!, {r4-r11}
    mov r11, r3
    sub r2, r2, #32
    b 1b
2:  cmp r2, #8
    blo 3f
    ldr r3, [r1, #-4]!
    mov r11, r11, lsl lr
    orr r11, r11, r3, lsr r12
    str r11, [r0, #-4]!
    mov r11, r3
    sub r2, r2, #4
    b 2b
    @ Back to one past the last source byte not copied, (source & 3) after r1.
3:  add r1, r1, r12, lsr #3
7:  pop {r4-r11, lr}
4:  cmp r2, #0
    bxeq lr
    ldrb r3, [r1, #-1]!
    strb r3, [r0, #-1]!
    sub r2, r2, #1
    b 4b
retro_shifted_end:
