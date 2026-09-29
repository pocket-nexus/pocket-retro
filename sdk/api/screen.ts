/**
 * Drawing on the screen (pyxel.cls, pset, blt, text, pal, clip, ...) and
 * its display colors (pyxel.colors): `screen.cls(color.navy)`.
 */
import { f32, len, type f32 as F32, type i32 as I32 } from "@pocketjs/framework/solid/std";
import {
  blt as surfaceBlt,
  bltm as surfaceBltm,
  bltTransformed,
  circ as surfaceCirc,
  circb as surfaceCircb,
  cls as surfaceCls,
  elli as surfaceElli,
  ellib as surfaceEllib,
  floodFill,
  line as surfaceLine,
  mapColor,
  pget as surfacePget,
  pset as surfacePset,
  rect as surfaceRect,
  rectb as surfaceRectb,
  resetClip,
  resetColorMap,
  SCREEN,
  setCamera,
  setClip,
  setDither,
  text as surfaceText,
  tri as surfaceTri,
  trib as surfaceTrib,
} from "../gfx";
import { colors, setColor as hwSetColor, setColorList } from "../hw";

export function cls(col: I32): void {
  surfaceCls(SCREEN, col);
}

export function pget(x: I32, y: I32): I32 {
  return surfacePget(SCREEN, x, y);
}

export function pset(x: I32, y: I32, col: I32): void {
  surfacePset(SCREEN, x, y, col);
}

export function line(x1: I32, y1: I32, x2: I32, y2: I32, col: I32): void {
  surfaceLine(SCREEN, x1, y1, x2, y2, col);
}

export function rect(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRect(SCREEN, x, y, w, h, col);
}

export function rectb(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRectb(SCREEN, x, y, w, h, col);
}

export function circ(x: I32, y: I32, r: I32, col: I32): void {
  surfaceCirc(SCREEN, x, y, r, col);
}

export function circb(x: I32, y: I32, r: I32, col: I32): void {
  surfaceCircb(SCREEN, x, y, r, col);
}

export function elli(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceElli(SCREEN, x, y, w, h, col);
}

export function ellib(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceEllib(SCREEN, x, y, w, h, col);
}

export function tri(x1: I32, y1: I32, x2: I32, y2: I32, x3: I32, y3: I32, col: I32): void {
  surfaceTri(SCREEN, x1, y1, x2, y2, x3, y3, col);
}

export function trib(x1: I32, y1: I32, x2: I32, y2: I32, x3: I32, y3: I32, col: I32): void {
  surfaceTrib(SCREEN, x1, y1, x2, y2, x3, y3, col);
}

/** Flood fill (pyxel.fill). */
export function fill(x: I32, y: I32, col: I32): void {
  floodFill(SCREEN, x, y, col);
}

/**
 * Draws the w x h region at (u, v) of image bank `img` (or image.screen) at
 * (x, y). Negative w or h flips; colkey -1 draws every pixel. rotate is in
 * degrees clockwise and scale is a factor, both about the region's center.
 */
export function blt(
  x: I32,
  y: I32,
  img: I32,
  u: I32,
  v: I32,
  w: I32,
  h: I32,
  colkey: I32 = -1,
  rotate: F32 = 0.0,
  scale: F32 = 1.0,
): void {
  if (rotate !== f32(0) || scale !== f32(1)) bltTransformed(SCREEN, x, y, img, u, v, w, h, colkey, rotate, scale);
  else surfaceBlt(SCREEN, x, y, img, u, v, w, h, colkey);
}

/** Draws the w x h pixel region at (u, v) of tilemap tm at (x, y). */
export function bltm(x: I32, y: I32, tm: I32, u: I32, v: I32, w: I32, h: I32, colkey: I32 = -1): void {
  surfaceBltm(SCREEN, x, y, tm, u, v, w, h, colkey);
}

/** Draws text with Pyxel's 4 x 6 font; "\n" starts a new line. */
export function text(x: I32, y: I32, s: string, col: I32): void {
  surfaceText(SCREEN, x, y, s, col);
}

/** pal(col1, col2) draws col1 as col2; pal() resets the draw palette. */
export function pal(col1: I32 = -1, col2: I32 = -1): void {
  if (col1 < 0) resetColorMap(SCREEN);
  else mapColor(SCREEN, col1, col2);
}

/** Ordered dithering: alpha 1.0 draws every pixel, 0.0 none. */
export function dither(alpha: F32): void {
  setDither(SCREEN, alpha);
}

/** camera(x, y) offsets drawing by (-x, -y); camera() resets it. */
export function camera(x: I32 = 0, y: I32 = 0): void {
  setCamera(SCREEN, x, y);
}

/** clip(x, y, w, h) limits drawing to a rectangle; clip() resets it. */
export function clip(x: I32 = -1, y: I32 = -1, w: I32 = -1, h: I32 = -1): void {
  if (x === -1 && y === -1 && w === -1 && h === -1) resetClip(SCREEN);
  else setClip(SCREEN, x, y, w, h);
}

/** pyxel.colors[index] = rgb. */
export function setColor(index: I32, rgb: I32): void {
  hwSetColor(index, rgb);
}

/** pyxel.colors[index], or 0 past the last color. */
export function getColor(index: I32): I32 {
  return index >= 0 && index < len(colors) ? colors[index] : 0;
}

/** pyxel.colors.from_list(list). */
export function setColors(list: I32[]): void {
  setColorList(list);
}

/** len(pyxel.colors). */
export function colorCount(): I32 {
  return len(colors);
}
