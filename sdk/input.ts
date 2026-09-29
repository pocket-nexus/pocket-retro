/**
 * Pyxel keys on GBA buttons. Every Pyxel key or gamepad button a game asks
 * about maps to a set of GBA buttons; the key is down while any of them is.
 * mapKey() changes a mapping, for example to put KEY_X on the B button.
 */
import { fill, i32, u16, type i32 as I32, type u16 as U16 } from "@pocketjs/framework/solid/std";

// KEYINPUT bits, as the host passes them.
export const GBA_A: I32 = 1;
export const GBA_B: I32 = 2;
export const GBA_SELECT: I32 = 4;
export const GBA_START: I32 = 8;
export const GBA_RIGHT: I32 = 16;
export const GBA_LEFT: I32 = 32;
export const GBA_UP: I32 = 64;
export const GBA_DOWN: I32 = 128;
export const GBA_R: I32 = 256;
export const GBA_L: I32 = 512;

/** Number of key ids; retro.ts numbers its KEY_* and GAMEPAD* constants below this. */
export const KEY_COUNT: I32 = 128;

let buttons: I32 = 0;
let previous: I32 = 0;
let frame: I32 = 0;
/** Frame at which each GBA button last went down. */
let downFrames: I32[] = fill(10, 0);
let keyMap: U16[] = fill(KEY_COUNT, u16(0));

export function mapKey(key: I32, gbaButtons: I32): void {
  if (key >= 0 && key < KEY_COUNT) keyMap[key] = u16(gbaButtons);
}

export function keyButtons(key: I32): I32 {
  return key >= 0 && key < KEY_COUNT ? i32(keyMap[key]) : 0;
}

export function update(keys: I32, frameCount: I32): void {
  previous = buttons;
  buttons = keys;
  frame = frameCount;
  for (let b = 0; b < 10; b++) {
    const bit = 1 << b;
    if ((buttons & bit) !== 0 && (previous & bit) === 0) downFrames[b] = frameCount;
  }
}

export function btn(key: I32): boolean {
  return (buttons & keyButtons(key)) !== 0;
}

/**
 * True on the frame a key goes down; with repeat > 0, also every `repeat`
 * frames once it has been held for `hold` frames.
 */
export function btnp(key: I32, hold: I32, repeat: I32): boolean {
  const mask = keyButtons(key);
  if ((buttons & mask) === 0) return false;
  if ((previous & mask) === 0) return true;
  if (repeat <= 0) return false;
  // The key has been down since the earliest down frame among its held buttons.
  let since = frame;
  for (let b = 0; b < 10; b++) if ((buttons & mask & (1 << b)) !== 0 && downFrames[b] < since) since = downFrames[b];
  const elapsed = frame - (since + hold);
  return elapsed >= 0 && elapsed % repeat === 0;
}

export function btnr(key: I32): boolean {
  const mask = keyButtons(key);
  return (previous & mask) !== 0 && (buttons & mask) === 0;
}

export function rawButtons(): I32 {
  return buttons;
}
