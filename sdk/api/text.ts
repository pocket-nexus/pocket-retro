/**
 * Text helpers: Python's str() and padding for integers and strings, and the
 * size of Pyxel's font. `text.rjust(text.str(score), 5)`; screen.text() draws.
 */
import { len, type i32 as I32 } from "@pocketjs/framework/solid/std";
import { textWidth } from "../gfx";

/** Width of a character of the built-in font (FONT_WIDTH). */
export const FONT_WIDTH: I32 = 4;
/** Height of a character of the built-in font (FONT_HEIGHT). */
export const FONT_HEIGHT: I32 = 6;

/** Width in pixels of the widest line of `s` in the built-in font. */
export function width(s: string): I32 {
  return textWidth(s);
}

/** Python's str() of an integer. */
export function str(n: I32): string {
  return `${n}`;
}

/** Python's s.rjust(width, fill): pads on the left to `width` characters. */
export function rjust(s: string, width: I32, fill: string = " "): string {
  let out = s;
  for (let i = len(s); i < width; i++) out = fill + out;
  return out;
}

/** Python's s.ljust(width, fill): pads on the right to `width` characters. */
export function ljust(s: string, width: I32, fill: string = " "): string {
  let out = s;
  for (let i = len(s); i < width; i++) out = out + fill;
  return out;
}

/** Python's str(n).zfill(width) for an integer. */
export function zfill(n: I32, width: I32): string {
  const digits = rjust(`${n < 0 ? -n : n}`, n < 0 ? width - 1 : width, "0");
  return n < 0 ? "-" + digits : digits;
}
