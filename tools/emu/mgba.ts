/** Bun FFI binding for the headless mGBA frontend in shim.c. */
import { dlopen, FFIType, ptr } from "bun:ffi";
import { writeFileSync } from "node:fs";
import { encodePng } from "../lib/png.ts";
import { setupEmulator } from "./setup.ts";

/** KEYINPUT bit positions. */
export const KEY = {
  A: 1 << 0,
  B: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  RIGHT: 1 << 4,
  LEFT: 1 << 5,
  UP: 1 << 6,
  DOWN: 1 << 7,
  R: 1 << 8,
  L: 1 << 9,
} as const;
export type KeyName = keyof typeof KEY;

export const SCREEN_WIDTH = 240;
export const SCREEN_HEIGHT = 160;
export const AUDIO_RATE = 32768;

const symbols = {
  emu_open: { args: [FFIType.cstring], returns: FFIType.i32 },
  emu_close: { args: [], returns: FFIType.void },
  emu_set_keys: { args: [FFIType.u32], returns: FFIType.void },
  emu_run_frames: { args: [FFIType.i32], returns: FFIType.void },
  emu_frame_counter: { args: [], returns: FFIType.u32 },
  emu_video_rgba: { args: [FFIType.ptr], returns: FFIType.void },
  emu_audio: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  emu_read: { args: [FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.void },
  emu_take_log: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
} as const;

type Library = ReturnType<typeof dlopen<typeof symbols>>;
let library: Library | undefined;
let open = false;

/**
 * One emulated GBA. The shim holds a single core, so only one instance may be
 * open per process; close it before opening another ROM.
 */
export class Gba {
  private readonly lib: Library["symbols"];
  private readonly video = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  private readonly logBuffer = new Uint8Array(1 << 20);
  private readonly audioBuffer = new Int16Array(1 << 16);
  private readonly samples: Int16Array[] = [];
  /** Text printed by the ROM through the mGBA debug registers, plus emulator warnings. */
  logText = "";
  keys = 0;
  recordAudio = false;

  private constructor(lib: Library["symbols"]) {
    this.lib = lib;
  }

  static async open(rom: string): Promise<Gba> {
    if (open) throw new Error("another Gba instance is open");
    library ??= dlopen(await setupEmulator(), symbols);
    const status = library.symbols.emu_open(Buffer.from(rom + "\0"));
    if (status !== 0) throw new Error(`mGBA could not load ${rom} (${status})`);
    open = true;
    return new Gba(library.symbols);
  }

  close(): void {
    this.lib.emu_close();
    open = false;
  }

  setKeys(keys: number | KeyName[]): void {
    this.keys = typeof keys === "number" ? keys : keys.reduce((mask, name) => mask | KEY[name], 0);
    this.lib.emu_set_keys(this.keys);
  }

  run(frames = 1): void {
    for (let i = 0; i < frames; i++) {
      this.lib.emu_run_frames(1);
      const count = this.lib.emu_audio(ptr(this.audioBuffer), this.audioBuffer.length / 2);
      if (this.recordAudio && count > 0) this.samples.push(this.audioBuffer.slice(0, count * 2));
    }
    this.collectLog();
  }

  /** Holds keys for the given number of frames, then releases them. */
  press(keys: KeyName[], frames = 2): void {
    this.setKeys(keys);
    this.run(frames);
    this.setKeys(0);
  }

  get frameCounter(): number {
    return this.lib.emu_frame_counter();
  }

  frame(): Uint8Array {
    this.lib.emu_video_rgba(ptr(this.video));
    return this.video.slice();
  }

  screenshot(path: string, scale = 2): void {
    writeFileSync(path, encodePng(this.frame(), SCREEN_WIDTH, SCREEN_HEIGHT, scale));
  }

  read(address: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    this.lib.emu_read(address, ptr(out), length);
    return out;
  }

  read32(address: number): number {
    return new DataView(this.read(address, 4).buffer).getUint32(0, true);
  }

  /** Interleaved stereo samples recorded since recordAudio was set. */
  audio(): Int16Array {
    const total = this.samples.reduce((sum, part) => sum + part.length, 0);
    const out = new Int16Array(total);
    let offset = 0;
    for (const part of this.samples) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  writeWav(path: string): void {
    const pcm = this.audio();
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.byteLength, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(AUDIO_RATE, 24);
    header.writeUInt32LE(AUDIO_RATE * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.byteLength, 40);
    writeFileSync(path, Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]));
  }

  private collectLog(): void {
    const length = this.lib.emu_take_log(ptr(this.logBuffer), this.logBuffer.length);
    if (length < 0) throw new Error("mGBA log overflowed; read it more often");
    if (length > 0) this.logText += new TextDecoder().decode(this.logBuffer.subarray(0, length));
  }
}
