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
    eor r3, r0, r1
    tst r3, #3
    bne copy_shifted
copy_align:
    cmp r2, #0
    bxeq lr
    tst r0, #3
    beq copy_words
    ldrb r3, [r1], #1
    strb r3, [r0], #1
    sub r2, r2, #1
    b copy_align
copy_words:
    push {r4-r10}
copy_blocks:
    cmp r2, #32
    blo copy_restore
    ldmia r1!, {r3-r10}
    stmia r0!, {r3-r10}
    sub r2, r2, #32
    b copy_blocks
copy_restore:
    pop {r4-r10}
copy_word:
    cmp r2, #4
    blo copy_bytes
    ldr r3, [r1], #4
    str r3, [r0], #4
    sub r2, r2, #4
    b copy_word
copy_bytes:
    cmp r2, #0
    bxeq lr
    ldrb r3, [r1], #1
    strb r3, [r0], #1
    sub r2, r2, #1
    b copy_bytes

@ Source and destination differ in alignment: bytes until the destination
@ is aligned, then each word is put together from two aligned source words,
@ about four times as fast as bytes. Reading a whole source word may read up
@ to three bytes past either end of the source, which the GBA allows.
copy_shifted:
    cmp r2, #8
    blo copy_bytes
shifted_align:
    tst r0, #3
    beq shifted_words
    ldrb r3, [r1], #1
    strb r3, [r0], #1
    sub r2, r2, #1
    b shifted_align
shifted_words:
    push {r4-r6}
    and r12, r1, #3
    bic r1, r1, #3
    mov r12, r12, lsl #3
    rsb r6, r12, #32
    ldr r3, [r1], #4
shifted_loop:
    cmp r2, #4
    blo shifted_done
    ldr r4, [r1], #4
    mov r5, r3, lsr r12
    orr r5, r5, r4, lsl r6
    str r5, [r0], #4
    mov r3, r4
    sub r2, r2, #4
    b shifted_loop
shifted_done:
    sub r1, r1, #4
    add r1, r1, r12, lsr #3
    pop {r4-r6}
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
move_back:
    cmp r2, #0
    bxeq lr
    ldrb r3, [r1, #-1]!
    strb r3, [r0, #-1]!
    sub r2, r2, #1
    b move_back
