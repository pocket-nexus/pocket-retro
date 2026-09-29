/**
 * State shared with the GBA host. Exported fields of this state module become
 * native accessors named `hw_<field>()` and `hw_<field>_mut()` on the compiled
 * model; runtime/gba reads them after every frame.
 */
import { fill, len, push, type i32, type u8 } from "@pocketjs/framework/solid/std";

/** Output sample rate of the host's mixer: 304 samples per VBlank. */
export const AUDIO_RATE: i32 = 18157;

export const DEFAULT_COLORS: i32[] = [
  0x000000, 0x2b335f, 0x7e2072, 0x19959c, 0x8b4852, 0x395c98, 0xa9c1ff, 0xeeeeee, 0xd4186c, 0xd38441, 0xe9c35b,
  0x70c6a9, 0x7696de, 0xa3a3a3, 0xff9798, 0xedc7b0,
];

/** The screen: one palette index per pixel, row-major, `width` x `height`. */
export let screen: u8[] = [];
export let width: i32 = 0;
export let height: i32 = 0;
/** Display colors as 0xRRGGBB, indexed by palette entry. */
export let colors: i32[] = [];
export let fps: i32 = 30;
/**
 * Voice parameters for the mixer, three values per channel per audio tick
 * (1/120 s): tone (0 triangle, 1 square, 2 pulse, 3 noise, -1 silent), phase
 * step per sample of a 32-sample waveform in 16.16 fixed point, and amplitude
 * (output = sample * amplitude >> 6 for samples in -15..15). The host drains
 * the list after each frame.
 */
export let voices: i32[] = [];

export function setScreen(w: i32, h: i32): void {
  width = w;
  height = h;
  screen = fill(w * h, 0);
}

export function setFps(value: i32): void {
  fps = value;
}

export function setColor(index: i32, rgb: i32): void {
  if (index < 0 || index > 255) return;
  while (index >= colorCount()) push(colors, 0);
  colors[index] = rgb & 0xffffff;
}

export function colorCount(): i32 {
  return len(colors);
}

export function setColorList(list: i32[]): void {
  colors = list;
}

export function pushVoice(tone: i32, step: i32, amplitude: i32): void {
  push(voices, tone);
  push(voices, step);
  push(voices, amplitude);
}
