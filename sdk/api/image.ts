/**
 * Image banks (pyxel.images[n]): each method takes the bank first, so
 * pyxel.images[1].pset(x, y, c) is `image.pset(1, x, y, c)`.
 */
import { codePoints, len, type i32 as I32 } from "@pocketjs/framework/solid/std";
import {
  blt as surfaceBlt,
  bltm as surfaceBltm,
  circ as surfaceCirc,
  circb as surfaceCircb,
  cls as surfaceCls,
  floodFill,
  IMAGE_SIZE,
  line as surfaceLine,
  pget as surfacePget,
  pset as surfacePset,
  rect as surfaceRect,
  rectb as surfaceRectb,
  SCREEN as SCREEN_SURFACE,
  text as surfaceText,
  tri as surfaceTri,
} from "../gfx";
import { hexDigit } from "../hex";

/** Image banks (NUM_IMAGES). */
export const COUNT: I32 = 3;
/** Width and height of a bank (IMAGE_SIZE). */
export const SIZE: I32 = IMAGE_SIZE;
/** The screen as a blt source, as pyxel.screen. */
export const SCREEN: I32 = SCREEN_SURFACE;

export function pget(img: I32, x: I32, y: I32): I32 {
  return surfacePget(img, x, y);
}

export function pset(img: I32, x: I32, y: I32, col: I32): void {
  surfacePset(img, x, y, col);
}

export function cls(img: I32, col: I32): void {
  surfaceCls(img, col);
}

export function line(img: I32, x1: I32, y1: I32, x2: I32, y2: I32, col: I32): void {
  surfaceLine(img, x1, y1, x2, y2, col);
}

export function rect(img: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRect(img, x, y, w, h, col);
}

export function rectb(img: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRectb(img, x, y, w, h, col);
}

export function circ(img: I32, x: I32, y: I32, r: I32, col: I32): void {
  surfaceCirc(img, x, y, r, col);
}

export function circb(img: I32, x: I32, y: I32, r: I32, col: I32): void {
  surfaceCircb(img, x, y, r, col);
}

export function tri(img: I32, x1: I32, y1: I32, x2: I32, y2: I32, x3: I32, y3: I32, col: I32): void {
  surfaceTri(img, x1, y1, x2, y2, x3, y3, col);
}

export function fill(img: I32, x: I32, y: I32, col: I32): void {
  floodFill(img, x, y, col);
}

export function blt(img: I32, x: I32, y: I32, src: I32, u: I32, v: I32, w: I32, h: I32, colkey: I32 = -1): void {
  surfaceBlt(img, x, y, src, u, v, w, h, colkey);
}

export function bltm(img: I32, x: I32, y: I32, tm: I32, u: I32, v: I32, w: I32, h: I32, colkey: I32 = -1): void {
  surfaceBltm(img, x, y, tm, u, v, w, h, colkey);
}

export function text(img: I32, x: I32, y: I32, s: string, col: I32): void {
  surfaceText(img, x, y, s, col);
}

/**
 * pyxel.images[img].set(x, y, rows): each row is a string of hex digits,
 * one palette index per pixel.
 */
export function set(img: I32, x: I32, y: I32, rows: string[]): void {
  for (let j = 0; j < len(rows); j++) {
    let i = 0;
    for (const code of codePoints(rows[j])) {
      const digit = hexDigit(code);
      if (digit < 0) continue;
      surfacePset(img, x + i, y + j, digit);
      i++;
    }
  }
}
