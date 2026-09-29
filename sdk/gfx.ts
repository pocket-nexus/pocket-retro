/**
 * Drawing on the four surfaces: image banks 0-2 and the screen (SCREEN = 3).
 *
 * Each surface has Pyxel's per-image state: camera offset, clip rectangle,
 * draw palette and dither pattern. Image banks start as read-only data baked
 * into the cartridge; the first write copies a bank into RAM (64 KiB).
 * Rasterization follows pyxel-core's canvas.rs so ported games draw the same
 * pixels. Functions tagged `@iwram` run from internal RAM as ARM code.
 */
import {
  codePoints,
  copyRange,
  cos as stdCos,
  fill,
  fillRange,
  f32,
  i32,
  idiv,
  len,
  pop,
  push,
  sin as stdSin,
  u8,
  type f32 as F32,
  type i32 as I32,
  type u8 as U8,
} from "@pocketjs/framework/solid/std";
import { IMAGES, TILEMAP_IMAGES, TILEMAPS } from "./assets";
import { height, screen, width } from "./hw";

export const SCREEN: I32 = 3;
export const IMAGE_SIZE: I32 = 256;
const BANK_BYTES: I32 = 65536;
const ALL_PIXELS: I32 = 0xffff;
// Pyxel's ordered-dither thresholds in sixteenths, row-major over a 4x4 cell.
const DITHER: I32[] = [1, 9, 3, 11, 13, 5, 15, 7, 3, 11, 1, 9, 15, 7, 13, 5];

// Per-surface state, indexed by surface id 0-3.
let camX: I32[] = [0, 0, 0, 0];
let camY: I32[] = [0, 0, 0, 0];
let clipX1: I32[] = [0, 0, 0, 0];
let clipY1: I32[] = [0, 0, 0, 0];
let clipX2: I32[] = [255, 255, 255, 0];
let clipY2: I32[] = [255, 255, 255, 0];
let palMap: U8[] = fill(1024, 0);
let palIdentity: boolean[] = [true, true, true, true];
/** Bit (y & 3) * 4 + (x & 3) set where a pixel may be written. */
let ditherMask: I32[] = [ALL_PIXELS, ALL_PIXELS, ALL_PIXELS, ALL_PIXELS];
/** Image banks copied into RAM by their first write; empty while unchanged. */
let banks: U8[][] = [[], [], []];

export function resetSurfaces(): void {
  for (let s = 0; s < 4; s++) {
    for (let c = 0; c < 256; c++) palMap[s * 256 + c] = u8(c);
    palIdentity[s] = true;
    camX[s] = 0;
    camY[s] = 0;
    ditherMask[s] = ALL_PIXELS;
    resetClip(s);
  }
}

export function surfaceWidth(s: I32): I32 {
  return s === SCREEN ? width : IMAGE_SIZE;
}

export function surfaceHeight(s: I32): I32 {
  return s === SCREEN ? height : IMAGE_SIZE;
}

// ---- State ---------------------------------------------------------------

export function setCamera(s: I32, x: I32, y: I32): void {
  camX[s] = x;
  camY[s] = y;
}

export function resetClip(s: I32): void {
  clipX1[s] = 0;
  clipY1[s] = 0;
  clipX2[s] = surfaceWidth(s) - 1;
  clipY2[s] = surfaceHeight(s) - 1;
}

/** Pyxel's clip: the rectangle intersected with the surface; negative sizes are empty. */
export function setClip(s: I32, x: I32, y: I32, w: I32, h: I32): void {
  clipX1[s] = x < 0 ? 0 : x;
  clipY1[s] = y < 0 ? 0 : y;
  const right = x + (w < 0 ? 0 : w) - 1,
    bottom = y + (h < 0 ? 0 : h) - 1;
  clipX2[s] = right > surfaceWidth(s) - 1 ? surfaceWidth(s) - 1 : right;
  clipY2[s] = bottom > surfaceHeight(s) - 1 ? surfaceHeight(s) - 1 : bottom;
}

export function mapColor(s: I32, from: I32, to: I32): void {
  palMap[s * 256 + (from & 255)] = u8(to);
  palIdentity[s] = false;
}

export function resetColorMap(s: I32): void {
  for (let c = 0; c < 256; c++) palMap[s * 256 + c] = u8(c);
  palIdentity[s] = true;
}

export function setDither(s: I32, alpha: F32): void {
  let mask = 0;
  for (let i = 0; i < 16; i++) if (alpha * f32(16) > f32(DITHER[i])) mask |= 1 << i;
  ditherMask[s] = mask;
}

/** Rounds half away from zero, as Rust's f32::round does in pyxel-core. */
export function round(value: F32): I32 {
  return i32(value + (value < f32(0) ? f32(-0.5) : f32(0.5)));
}

/** @iwram */
function mapped(s: I32, col: I32): I32 {
  return i32(palMap[s * 256 + (col & 255)]);
}

// ---- Pixels --------------------------------------------------------------

/** Copies a bank into RAM before its first write. */
function writable(s: I32): void {
  if (s < SCREEN && len(banks[s]) === 0) {
    banks[s] = fill(BANK_BYTES, u8(0));
    copyRange(banks[s], 0, IMAGES, s * BANK_BYTES, BANK_BYTES);
  }
}

/** Reads a surface pixel without camera or clip. */
/** @iwram */
export function read(s: I32, x: I32, y: I32): I32 {
  if (s === SCREEN) return i32(screen[y * width + x]);
  if (len(banks[s]) > 0) return i32(banks[s][y * IMAGE_SIZE + x]);
  return i32(IMAGES[s * BANK_BYTES + y * IMAGE_SIZE + x]);
}

/** Writes an already mapped color inside the clip rectangle, honoring dither. */
/** @iwram */
function put(s: I32, x: I32, y: I32, value: I32): void {
  if (x < clipX1[s] || x > clipX2[s] || y < clipY1[s] || y > clipY2[s]) return;
  if (ditherMask[s] !== ALL_PIXELS && (ditherMask[s] & (1 << (((y & 3) << 2) | (x & 3)))) === 0) return;
  if (s === SCREEN) screen[y * width + x] = u8(value);
  else banks[s][y * IMAGE_SIZE + x] = u8(value);
}

export function pget(s: I32, x: I32, y: I32): I32 {
  if (x < clipX1[s] || x > clipX2[s] || y < clipY1[s] || y > clipY2[s]) return 0;
  return read(s, x, y);
}

export function pset(s: I32, x: I32, y: I32, col: I32): void {
  writable(s);
  put(s, x - camX[s], y - camY[s], mapped(s, col));
}

export function cls(s: I32, col: I32): void {
  writable(s);
  const value = u8(mapped(s, col));
  if (s === SCREEN) fillRange(screen, 0, width * height, value);
  else fillRange(banks[s], 0, BANK_BYTES, value);
}

/** Horizontal run from x1 to x2 inclusive on row y, clipped; value is mapped. */
/** @iwram */
function row(s: I32, x1: I32, x2: I32, y: I32, value: I32): void {
  if (y < clipY1[s] || y > clipY2[s]) return;
  const left = x1 < clipX1[s] ? clipX1[s] : x1;
  const right = x2 > clipX2[s] ? clipX2[s] : x2;
  if (left > right) return;
  if (ditherMask[s] !== ALL_PIXELS) {
    for (let x = left; x <= right; x++) put(s, x, y, value);
  } else if (s === SCREEN) {
    fillRange(screen, y * width + left, y * width + right + 1, u8(value));
  } else {
    fillRange(banks[s], y * IMAGE_SIZE + left, y * IMAGE_SIZE + right + 1, u8(value));
  }
}

/** Vertical run from y1 to y2 inclusive on column x, clipped; value is mapped. */
/** @iwram */
function column(s: I32, y1: I32, y2: I32, x: I32, value: I32): void {
  if (x < clipX1[s] || x > clipX2[s]) return;
  const top = y1 < clipY1[s] ? clipY1[s] : y1;
  const bottom = y2 > clipY2[s] ? clipY2[s] : y2;
  for (let y = top; y <= bottom; y++) put(s, x, y, value);
}

// ---- Shapes --------------------------------------------------------------

/** round(n / d) with halves away from zero, for d > 0. */
function divRound(n: I32, d: I32): I32 {
  return n >= 0 ? idiv(2 * n + d, 2 * d) : -idiv(-2 * n + d, 2 * d);
}

/** Rounds a fixed-point value with `bits` fraction bits, halves away from zero. */
function roundFixed(value: I32, bits: I32): I32 {
  const half = 1 << (bits - 1);
  return value >= 0 ? (value + half) >> bits : -((-value + half) >> bits);
}

/** Integer square root: the largest r with r * r <= n, for n >= 0. */
function isqrt(n: I32): I32 {
  let rest = n,
    root = 0,
    bit = 1 << 30;
  while (bit > rest) bit >>= 2;
  while (bit !== 0) {
    if (rest >= root + bit) {
      rest -= root + bit;
      root = (root >> 1) + bit;
    } else {
      root >>= 1;
    }
    bit >>= 2;
  }
  return root;
}

// Lines, triangles and ellipses follow canvas.rs, which computes in f32 and
// rounds halves away from zero. Here the same quantities are exact rationals
// or fixed point, since the GBA has no FPU; a pixel can differ only where
// f32 rounding lands exactly on a half.

export function line(s: I32, ax: I32, ay: I32, bx: I32, by: I32, col: I32): void {
  writable(s);
  const value = mapped(s, col);
  const x1 = ax - camX[s],
    y1 = ay - camY[s],
    x2 = bx - camX[s],
    y2 = by - camY[s];
  if (y1 === y2) {
    row(s, x1 < x2 ? x1 : x2, x1 < x2 ? x2 : x1, y1, value);
  } else if (x1 === x2) {
    column(s, y1 < y2 ? y1 : y2, y1 < y2 ? y2 : y1, x1, value);
  } else if ((x1 > x2 ? x1 - x2 : x2 - x1) > (y1 > y2 ? y1 - y2 : y2 - y1)) {
    const sx = x1 < x2 ? x1 : x2,
      sy = x1 < x2 ? y1 : y2,
      ex = x1 < x2 ? x2 : x1,
      ey = x1 < x2 ? y2 : y1;
    diagonal(s, sx, sy, ex - sx, ey - sy, value, true);
  } else {
    const sx = y1 < y2 ? x1 : x2,
      sy = y1 < y2 ? y1 : y2,
      ex = y1 < y2 ? x2 : x1,
      ey = y1 < y2 ? y2 : y1;
    diagonal(s, sy, sx, ey - sy, ex - sx, value, false);
  }
}

/** Steps `major` pixels along one axis, placing the other at round(minor * i / major). */
function diagonal(
  s: I32,
  majorStart: I32,
  minorStart: I32,
  major: I32,
  minor: I32,
  value: I32,
  horizontal: boolean,
): void {
  // A 20-bit fraction keeps minor << 20 and slope * i inside 32 bits for spans up to 2047.
  const exact = major > 2047;
  const slope = exact ? 0 : divRound(minor << 20, major);
  for (let i = 0; i <= major; i++) {
    const offset = exact ? divRound(minor * i, major) : roundFixed(slope * i, 20);
    if (horizontal) put(s, majorStart + i, minorStart + offset, value);
    else put(s, minorStart + offset, majorStart + i, value);
  }
}

export function rect(s: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  if (w <= 0 || h <= 0) return;
  writable(s);
  const value = mapped(s, col),
    left = x - camX[s],
    top = y - camY[s];
  for (let j = top; j < top + h; j++) row(s, left, left + w - 1, j, value);
}

export function rectb(s: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  if (w <= 0 || h <= 0) return;
  writable(s);
  const value = mapped(s, col),
    left = x - camX[s],
    top = y - camY[s],
    right = left + w - 1,
    bottom = top + h - 1;
  row(s, left, right, top, value);
  row(s, left, right, bottom, value);
  column(s, top, bottom, left, value);
  column(s, top, bottom, right, value);
}

// Result of ellipseArea(): the span of one column of an ellipse.
let areaX1: I32 = 0;
let areaY1: I32 = 0;
let areaX2: I32 = 0;
let areaY2: I32 = 0;

/**
 * canvas.rs ellipse_area in half units: the ellipse spans A = 2 ra and
 * B = 2 rb, is centered at (c2x, c2y) / 2, and the column is at x. The
 * column height is rb sqrt(1 - dx^2 / ra^2), widened by 0.01 before rounding.
 */
function ellipseArea(c2x: I32, c2y: I32, a: I32, b: I32, x: I32): void {
  const d = 2 * x - c2x;
  // Half-height in 8.8 fixed point: (B / 2) sqrt(A^2 - D^2) / A. The shift
  // keeps (A^2 - D^2) << shift inside 31 bits; sqrt then has shift / 2 fraction bits.
  const shift = a > 240 ? 8 : 14;
  const dy = a > 0 ? divRound(b * isqrt((a * a - d * d) << shift), 2 * a) << (8 - (shift >> 1)) : b << 7;
  const cy = c2y << 7;
  areaX1 = x - d;
  areaX2 = x;
  areaY1 = roundFixed(cy - dy - 3, 8);
  areaY2 = roundFixed(cy + dy + 3, 8);
}

export function circ(s: I32, x: I32, y: I32, r: I32, col: I32): void {
  if (r < 0) return;
  writable(s);
  const value = mapped(s, col),
    cx = x - camX[s],
    cy = y - camY[s];
  for (let xi = 0; xi <= r; xi++) {
    ellipseArea(0, 0, 2 * r, 2 * r, xi);
    column(s, cy + areaY1, cy + areaY2, cx + areaX1, value);
    column(s, cy + areaY1, cy + areaY2, cx + areaX2, value);
    row(s, cx + areaY1, cx + areaY2, cy + areaX1, value);
    row(s, cx + areaY1, cx + areaY2, cy + areaX2, value);
  }
}

export function circb(s: I32, x: I32, y: I32, r: I32, col: I32): void {
  if (r < 0) return;
  writable(s);
  const value = mapped(s, col),
    cx = x - camX[s],
    cy = y - camY[s];
  for (let xi = 0; xi <= r; xi++) {
    ellipseArea(0, 0, 2 * r, 2 * r, xi);
    put(s, cx + areaX1, cy + areaY1, value);
    put(s, cx + areaX2, cy + areaY1, value);
    put(s, cx + areaX1, cy + areaY2, value);
    put(s, cx + areaX2, cy + areaY2, value);
    put(s, cx + areaY1, cy + areaX1, value);
    put(s, cx + areaY1, cy + areaX2, value);
    put(s, cx + areaY2, cy + areaX1, value);
    put(s, cx + areaY2, cy + areaX2, value);
  }
}

function ellipse(s: I32, x: I32, y: I32, w: I32, h: I32, col: I32, filled: boolean): void {
  if (w <= 0 || h <= 0) return;
  writable(s);
  const value = mapped(s, col),
    left = x - camX[s],
    top = y - camY[s];
  const a = w - 1,
    b = h - 1,
    c2x = 2 * left + a,
    c2y = 2 * top + b;
  for (let xi = left; xi <= left + (w >> 1); xi++) {
    ellipseArea(c2x, c2y, a, b, xi);
    if (filled) {
      column(s, areaY1, areaY2, areaX1, value);
      column(s, areaY1, areaY2, areaX2, value);
    } else {
      put(s, areaX1, areaY1, value);
      put(s, areaX2, areaY1, value);
      put(s, areaX1, areaY2, value);
      put(s, areaX2, areaY2, value);
    }
  }
  for (let yi = top; yi <= top + (h >> 1); yi++) {
    // ellipse_area with the axes swapped yields (y1, x1, y2, x2).
    ellipseArea(c2y, c2x, b, a, yi);
    if (filled) {
      row(s, areaY1, areaY2, areaX1, value);
      row(s, areaY1, areaY2, areaX2, value);
    } else {
      put(s, areaY1, areaX1, value);
      put(s, areaY2, areaX1, value);
      put(s, areaY1, areaX2, value);
      put(s, areaY2, areaX2, value);
    }
  }
}

export function elli(s: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  ellipse(s, x, y, w, h, col, true);
}

export function ellib(s: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  ellipse(s, x, y, w, h, col, false);
}

export function tri(s: I32, ax: I32, ay: I32, bx: I32, by: I32, cx: I32, cy: I32, col: I32): void {
  writable(s);
  const value = mapped(s, col);
  // Sort the vertices by y, as canvas.rs does before splitting into spans.
  let x1 = ax - camX[s],
    y1 = ay - camY[s],
    x2 = bx - camX[s],
    y2 = by - camY[s],
    x3 = cx - camX[s],
    y3 = cy - camY[s];
  if (y1 > y2) {
    const tx = x1,
      ty = y1;
    x1 = x2;
    y1 = y2;
    x2 = tx;
    y2 = ty;
  }
  if (y1 > y3) {
    const tx = x1,
      ty = y1;
    x1 = x3;
    y1 = y3;
    x3 = tx;
    y3 = ty;
  }
  if (y2 > y3) {
    const tx = x2,
      ty = y2;
    x2 = x3;
    y2 = y3;
    x3 = tx;
    y3 = ty;
  }
  if (y1 === y3) {
    const lo = x1 < x2 ? (x1 < x3 ? x1 : x3) : x2 < x3 ? x2 : x3;
    const hi = x1 > x2 ? (x1 > x3 ? x1 : x3) : x2 > x3 ? x2 : x3;
    row(s, lo, hi, y1, value);
    return;
  }
  // The long edge crosses row y2 at split; each row joins it to the short edges.
  const split = x1 + divRound((x3 - x1) * (y2 - y1), y3 - y1);
  const top = y1 > clipY1[s] ? y1 : clipY1[s],
    bottom = y3 < clipY2[s] ? y3 : clipY2[s];
  for (let y = top; y <= bottom; y++) {
    const edge =
      y <= y2
        ? y2 === y1
          ? x2
          : x2 + divRound((x2 - x1) * (y - y2), y2 - y1)
        : x2 + divRound((x3 - x2) * (y - y2), y3 - y2);
    const middle = split + divRound((x3 - x1) * (y - y2), y3 - y1);
    if (split < x2) row(s, middle, edge, y, value);
    else row(s, edge, middle, y, value);
  }
}

export function trib(s: I32, ax: I32, ay: I32, bx: I32, by: I32, cx: I32, cy: I32, col: I32): void {
  line(s, ax, ay, bx, by, col);
  line(s, ax, ay, cx, cy, col);
  line(s, bx, by, cx, cy, col);
}

/** Scanline flood fill from (x, y) over the 4-connected region of its color. */
export function floodFill(s: I32, x: I32, y: I32, col: I32): void {
  writable(s);
  const sx = x - camX[s],
    sy = y - camY[s];
  if (sx < clipX1[s] || sx > clipX2[s] || sy < clipY1[s] || sy > clipY2[s]) return;
  const value = mapped(s, col),
    target = read(s, sx, sy);
  if (value === target) return;
  const stack: I32[] = [sx, sy];
  while (len(stack) > 0) {
    const py = pop(stack),
      px = pop(stack);
    if (read(s, px, py) !== target) continue;
    let left = px,
      right = px;
    while (left > clipX1[s] && read(s, left - 1, py) === target) left--;
    while (right < clipX2[s] && read(s, right + 1, py) === target) right++;
    for (let fx = left; fx <= right; fx++) put(s, fx, py, value);
    for (let side = 0; side < 2; side++) {
      const scan = side === 0 ? py - 1 : py + 1;
      if (scan < clipY1[s] || scan > clipY2[s]) continue;
      let inside = false;
      for (let fx = left; fx <= right; fx++) {
        const hit = read(s, fx, scan) === target;
        if (hit && !inside) {
          push(stack, fx);
          push(stack, scan);
        }
        inside = hit;
      }
    }
  }
}

// ---- Blits ---------------------------------------------------------------

// Result of copyArea(), which clips a copy window as canvas.rs CopyArea does,
// including flipped copies that read their source backwards.
let copyDstX: I32 = 0;
let copyDstY: I32 = 0;
let copySrcX: I32 = 0;
let copySrcY: I32 = 0;
let copySignX: I32 = 1;
let copySignY: I32 = 1;
let copyOffX: I32 = 0;
let copyOffY: I32 = 0;
let copyW: I32 = 0;
let copyH: I32 = 0;

function larger(a: I32, b: I32): I32 {
  return a > b ? a : b;
}

function copyArea(
  s: I32,
  dstX: I32,
  dstY: I32,
  srcX: I32,
  srcY: I32,
  srcRight: I32,
  srcBottom: I32,
  w: I32,
  h: I32,
): void {
  const flipX = w < 0,
    flipY = h < 0;
  const aw = flipX ? -w : w,
    ah = flipY ? -h : h;
  const srcLeftCut = -srcX,
    srcTopCut = -srcY;
  const srcRightCut = srcX + aw - 1 - srcRight,
    srcBottomCut = srcY + ah - 1 - srcBottom;
  const leftCut = larger(larger(clipX1[s] - dstX, flipX ? srcRightCut : srcLeftCut), 0);
  const topCut = larger(larger(clipY1[s] - dstY, flipY ? srcBottomCut : srcTopCut), 0);
  const rightCut = larger(larger(dstX + aw - 1 - clipX2[s], flipX ? srcLeftCut : srcRightCut), 0);
  const bottomCut = larger(larger(dstY + ah - 1 - clipY2[s], flipY ? srcTopCut : srcBottomCut), 0);
  copyW = larger(aw - leftCut - rightCut, 0);
  copyH = larger(ah - topCut - bottomCut, 0);
  copySignX = flipX ? -1 : 1;
  copySignY = flipY ? -1 : 1;
  copyOffX = flipX ? copyW - 1 : 0;
  copyOffY = flipY ? copyH - 1 : 0;
  copyDstX = dstX + leftCut;
  copyDstY = dstY + topCut;
  copySrcX = srcX + (flipX ? rightCut : leftCut);
  copySrcY = srcY + (flipY ? bottomCut : topCut);
}

/** Copies n pixels from cartridge image data to the screen, skipping `key`. */
/** @iwram */
function romRowKeyed(di: I32, si: I32, n: I32, key: I32): void {
  for (let i = 0; i < n; i++) {
    const c = IMAGES[si + i];
    if (i32(c) !== key) screen[di + i] = c;
  }
}

/** As romRowKeyed, reading the source right to left from si. */
/** @iwram */
function romRowKeyedReversed(di: I32, si: I32, n: I32, key: I32): void {
  for (let i = 0; i < n; i++) {
    const c = IMAGES[si - i];
    if (i32(c) !== key) screen[di + i] = c;
  }
}

/** A screen row from any source with key, flip and draw palette. */
/** @iwram */
function rowGeneric(s: I32, img: I32, dx: I32, dy: I32, sx: I32, sy: I32, step: I32, n: I32, key: I32): void {
  for (let i = 0; i < n; i++) {
    const c = read(img, sx + step * i, sy);
    if (c !== key) put(s, dx + i, dy, mapped(s, c));
  }
}

/**
 * Copies a w x h region at (u, v) of image `img` to (x, y) of surface `s`.
 * Negative w or h flips; `key` is a transparent color, or -1 for none.
 */
export function blt(s: I32, x: I32, y: I32, img: I32, u: I32, v: I32, w: I32, h: I32, key: I32): void {
  if (img === s) {
    bltSelf(s, x, y, u, v, w, h, key);
    return;
  }
  writable(s);
  copyArea(s, x - camX[s], y - camY[s], u, v, surfaceWidth(img) - 1, surfaceHeight(img) - 1, w, h);
  if (copyW === 0 || copyH === 0) return;
  const direct =
    s === SCREEN && img < SCREEN && ditherMask[s] === ALL_PIXELS && palIdentity[s] && len(banks[img]) === 0;
  for (let yi = 0; yi < copyH; yi++) {
    const sy = copySrcY + copySignY * yi + copyOffY,
      dy = copyDstY + yi;
    if (direct) {
      const di = dy * width + copyDstX,
        si = img * BANK_BYTES + sy * IMAGE_SIZE + copySrcX;
      if (copySignX > 0 && key < 0) copyRange(screen, di, IMAGES, si, copyW);
      else if (copySignX > 0) romRowKeyed(di, si, copyW, key);
      else romRowKeyedReversed(di, si + copyOffX, copyW, key);
    } else {
      rowGeneric(s, img, copyDstX, dy, copySrcX + copyOffX, sy, copySignX, copyW, key);
    }
  }
}

/** A blit whose source is its destination reads a copy of the source region first. */
function bltSelf(s: I32, x: I32, y: I32, u: I32, v: I32, w: I32, h: I32, key: I32): void {
  const aw = w < 0 ? -w : w,
    ah = h < 0 ? -h : h;
  const copy: I32[] = fill(aw * ah, 0);
  for (let j = 0; j < ah; j++)
    for (let i = 0; i < aw; i++) {
      const sx = u + i,
        sy = v + j;
      copy[j * aw + i] = sx < 0 || sy < 0 || sx >= surfaceWidth(s) || sy >= surfaceHeight(s) ? 0 : read(s, sx, sy);
    }
  writable(s);
  copyArea(s, x - camX[s], y - camY[s], 0, 0, aw - 1, ah - 1, w, h);
  for (let yi = 0; yi < copyH; yi++)
    for (let xi = 0; xi < copyW; xi++) {
      const c = copy[(copySrcY + copySignY * yi + copyOffY) * aw + copySrcX + copySignX * xi + copyOffX];
      if (c !== key) put(s, copyDstX + xi, copyDstY + yi, mapped(s, c));
    }
}

/**
 * Blit with rotation (degrees, clockwise) and scale about the region center,
 * following canvas.rs blit_with_transform. Source coordinates advance by
 * constant 16.16 fixed-point steps per destination pixel and row.
 */
export function bltTransformed(
  s: I32,
  x: I32,
  y: I32,
  img: I32,
  u: I32,
  v: I32,
  w: I32,
  h: I32,
  key: I32,
  rotate: F32,
  scale: F32,
): void {
  if (scale < f32(0.0001)) return;
  writable(s);
  const signX = w < 0 ? -1 : 1,
    signY = h < 0 ? -1 : 1;
  const aw = w < 0 ? -w : w,
    ah = h < 0 ? -h : h;
  const halfW: F32 = f32(aw - 1) / f32(2),
    halfH: F32 = f32(ah - 1) / f32(2);
  const dstCx: F32 = f32(x - camX[s]) + halfW,
    dstCy: F32 = f32(y - camY[s]) + halfH;
  const radians: F32 = rotate * f32(0.017453292);
  const sn: F32 = -stdSin(radians),
    cs: F32 = stdCos(radians);
  const absSin: F32 = sn < f32(0) ? -sn : sn,
    absCos: F32 = cs < f32(0) ? -cs : cs;
  const boundX: F32 = (halfW * absCos + halfH * absSin + f32(1)) * scale;
  const boundY: F32 = (halfW * absSin + halfH * absCos + f32(1)) * scale;
  const x1 = larger(round(dstCx - boundX), clipX1[s]),
    y1 = larger(round(dstCy - boundY), clipY1[s]);
  const x2r = round(dstCx + boundX),
    y2r = round(dstCy + boundY);
  const x2 = x2r < clipX2[s] ? x2r : clipX2[s],
    y2 = y2r < clipY2[s] ? y2r : clipY2[s];
  if (x1 > x2 || y1 > y2) return;
  // Source position of (x1, y1) and its steps per pixel and per row, 16.16.
  const cosS: F32 = (cs / scale) * f32(65536),
    sinS: F32 = (sn / scale) * f32(65536);
  const ox: F32 = (f32(x1) - dstCx) * f32(signX),
    oy: F32 = (f32(y1) - dstCy) * f32(signY);
  let rowX = i32((f32(u) + halfW) * f32(65536) + ox * (cs / scale) * f32(65536) - oy * sinS);
  let rowY = i32((f32(v) + halfH) * f32(65536) + ox * sinS + oy * cosS);
  const stepXx = signX * i32(cosS),
    stepXy = signX * i32(sinS),
    stepYx = -signY * i32(sinS),
    stepYy = signY * i32(cosS);
  const left = larger(u, 0),
    top = larger(v, 0);
  const right = u + aw - 1 < surfaceWidth(img) - 1 ? u + aw - 1 : surfaceWidth(img) - 1;
  const bottom = v + ah - 1 < surfaceHeight(img) - 1 ? v + ah - 1 : surfaceHeight(img) - 1;
  for (let yi = y1; yi <= y2; yi++) {
    let sx = rowX,
      sy = rowY;
    for (let xi = x1; xi <= x2; xi++) {
      const vx = roundFixed(sx, 16),
        vy = roundFixed(sy, 16);
      sx += stepXx;
      sy += stepXy;
      if (vx < left || vx > right || vy < top || vy > bottom) continue;
      const c = read(img, vx, vy);
      if (c !== key) put(s, xi, yi, mapped(s, c));
    }
    rowX += stepYx;
    rowY += stepYy;
  }
}

// ---- Tilemaps ------------------------------------------------------------

export const TILEMAP_SIZE: I32 = 256;
const TILEMAP_BYTES: I32 = 131072;
const OVERLAY_CAPACITY: I32 = 2048;
/**
 * Tiles written at run time, in an open-addressing hash over the cartridge
 * tilemaps: key tilemap << 16 | y << 8 | x (or -1 when free), value tile.
 */
let overlayKeys: I32[] = [];
let overlayTiles: I32[] = [];
let overlayCount: I32 = 0;
let tilemapSources: I32[] = [0, 0, 0, 0, 0, 0, 0, 0];

export function resetTilemaps(): void {
  for (let m = 0; m < 8; m++) tilemapSources[m] = m < len(TILEMAP_IMAGES) ? TILEMAP_IMAGES[m] : 0;
}

/** A tile value: image tile column in bits 0-7, tile row in bits 8-15. */
export function tile(tx: I32, ty: I32): I32 {
  return (tx & 255) | ((ty & 255) << 8);
}

function slot(key: I32): I32 {
  let index = ((key * 0x45d9f3b) >>> 21) & (OVERLAY_CAPACITY - 1);
  while (overlayKeys[index] !== -1 && overlayKeys[index] !== key) index = (index + 1) & (OVERLAY_CAPACITY - 1);
  return index;
}

/** The tile at (x, y) of tilemap m, in tiles; outside the map it is tile(0, 0). */
export function tget(m: I32, x: I32, y: I32): I32 {
  if (x < 0 || y < 0 || x >= TILEMAP_SIZE || y >= TILEMAP_SIZE) return 0;
  if (overlayCount > 0) {
    const index = slot((m << 16) | (y << 8) | x);
    if (overlayKeys[index] !== -1) return overlayTiles[index];
  }
  const at = m * TILEMAP_BYTES + (y * TILEMAP_SIZE + x) * 2;
  return i32(TILEMAPS[at]) | (i32(TILEMAPS[at + 1]) << 8);
}

export function tset(m: I32, x: I32, y: I32, value: I32): void {
  if (x < 0 || y < 0 || x >= TILEMAP_SIZE || y >= TILEMAP_SIZE) return;
  if (len(overlayKeys) === 0) {
    overlayKeys = fill(OVERLAY_CAPACITY, -1);
    overlayTiles = fill(OVERLAY_CAPACITY, 0);
  }
  const index = slot((m << 16) | (y << 8) | x);
  if (overlayKeys[index] === -1) {
    // Keep the table at most three quarters full so probes stay short.
    if (overlayCount * 4 >= OVERLAY_CAPACITY * 3) return;
    overlayKeys[index] = (m << 16) | (y << 8) | x;
    overlayCount++;
  }
  overlayTiles[index] = value;
}

export function setTilemapImage(m: I32, img: I32): void {
  tilemapSources[m] = img;
}

export function tilemapImage(m: I32): I32 {
  return tilemapSources[m];
}

/**
 * Draws the w x h pixel region at (u, v) of tilemap m to (x, y) of surface
 * s, as canvas.rs draw_tilemap does: each tile names an 8 x 8 image cell.
 */
export function bltm(s: I32, x: I32, y: I32, m: I32, u: I32, v: I32, w: I32, h: I32, key: I32): void {
  writable(s);
  copyArea(s, x - camX[s], y - camY[s], u, v, TILEMAP_SIZE * 8 - 1, TILEMAP_SIZE * 8 - 1, w, h);
  if (copyW === 0 || copyH === 0) return;
  const img = tilemapSources[m];
  const direct =
    s === SCREEN &&
    img < SCREEN &&
    copySignX > 0 &&
    ditherMask[s] === ALL_PIXELS &&
    palIdentity[s] &&
    len(banks[img]) === 0;
  for (let yi = 0; yi < copyH; yi++) {
    const ty = copySrcY + copySignY * yi + copyOffY,
      dy = copyDstY + yi;
    let xi = 0;
    while (xi < copyW) {
      const tx = copySrcX + copySignX * xi + copyOffX;
      const px = tx & 7;
      const value = tget(m, tx >> 3, ty >> 3);
      const ix = (value & 255) * 8 + px,
        iy = (value >> 8) * 8 + (ty & 7);
      if (direct) {
        const chunk = 8 - px < copyW - xi ? 8 - px : copyW - xi;
        if (ix < IMAGE_SIZE && iy < IMAGE_SIZE) {
          const valid = chunk < IMAGE_SIZE - ix ? chunk : IMAGE_SIZE - ix;
          const di = dy * width + copyDstX + xi,
            si = img * BANK_BYTES + iy * IMAGE_SIZE + ix;
          if (key < 0) copyRange(screen, di, IMAGES, si, valid);
          else romRowKeyed(di, si, valid, key);
        }
        xi += chunk;
      } else {
        if (ix < IMAGE_SIZE && iy < IMAGE_SIZE) {
          const c = read(img, ix, iy);
          if (c !== key) put(s, copyDstX + xi, dy, mapped(s, c));
        }
        xi++;
      }
    }
  }
}

// ---- Tilemap collision ---------------------------------------------------

export interface Delta {
  dx: I32;
  dy: I32;
}

/**
 * Wall sets for collide(): each is a bitset over the 32 x 32 tiles of an
 * image bank (tile x + 32 * tile y), 32 words per set.
 */
const WALL_SETS = 8;
let wallBits: I32[] = fill(WALL_SETS * 32, 0);
let wallSetCount: I32 = 0;

/** Registers a list of tile values (see tile()) as a wall set and returns its id. */
export function walls(tiles: I32[]): I32 {
  if (wallSetCount >= WALL_SETS) return WALL_SETS - 1;
  const set = wallSetCount;
  wallSetCount++;
  for (const t of tiles) {
    const tx = t & 255,
      ty = (t >> 8) & 255;
    if (tx < 32 && ty < 32) wallBits[set * 32 + ty] |= 1 << tx;
  }
  return set;
}

function isWall(m: I32, tx: I32, ty: I32, set: I32): boolean {
  if (tx < 0 || ty < 0 || tx >= TILEMAP_SIZE || ty >= TILEMAP_SIZE) return false;
  const t = tget(m, tx, ty);
  const cx = t & 255,
    cy = (t >> 8) & 255;
  return cx < 32 && cy < 32 && (wallBits[set * 32 + cy] & (1 << cx)) !== 0;
}

/** floor(a / 8) for any sign. */
function tileOf(a: I32): I32 {
  return a >> 3;
}

/**
 * Sweeps one axis of a w x h box at `pos` by `delta` against walls, as
 * tilemap.rs collide_resolve_axis does; returns the allowed delta. `vertical`
 * sweeps y with the cross axis over x tiles.
 */
function resolveAxis(
  m: I32,
  pos: I32,
  size: I32,
  delta: I32,
  crossStart: I32,
  crossEnd: I32,
  set: I32,
  vertical: boolean,
): I32 {
  if (delta === 0) return 0;
  if (delta > 0) {
    const edge = pos + size - 1;
    for (let primary = tileOf(edge) + 1; primary <= tileOf(edge + delta); primary++)
      for (let cross = crossStart; cross <= crossEnd; cross++)
        if (vertical ? isWall(m, cross, primary, set) : isWall(m, primary, cross, set)) return primary * 8 - size - pos;
  } else {
    for (let primary = tileOf(pos) - 1; primary >= tileOf(pos + delta); primary--)
      for (let cross = crossStart; cross <= crossEnd; cross++)
        if (vertical ? isWall(m, cross, primary, set) : isWall(m, primary, cross, set)) return (primary + 1) * 8 - pos;
  }
  return delta;
}

/**
 * pyxel.tilemaps[m].collide(x, y, w, h, dx, dy, walls) for integer positions:
 * moves a w x h box by (dx, dy), stopping at tiles of wall set `set`, and
 * returns the allowed movement. The larger axis resolves first.
 */
export function collide(m: I32, x: I32, y: I32, w: I32, h: I32, dx: I32, dy: I32, set: I32): Delta {
  const ax = dx < 0 ? -dx : dx,
    ay = dy < 0 ? -dy : dy;
  if (ax >= ay) {
    const ndx = resolveAxis(m, x, w, dx, tileOf(y), tileOf(y + h - 1), set, false);
    const ndy = resolveAxis(m, y, h, dy, tileOf(x + ndx), tileOf(x + ndx + w - 1), set, true);
    return { dx: ndx, dy: ndy };
  }
  const ndy = resolveAxis(m, y, h, dy, tileOf(x), tileOf(x + w - 1), set, true);
  const ndx = resolveAxis(m, x, w, dx, tileOf(y + ndy), tileOf(y + ndy + h - 1), set, false);
  return { dx: ndx, dy: ndy };
}

// ---- Text ----------------------------------------------------------------

export const FONT_WIDTH: I32 = 4;
export const FONT_HEIGHT: I32 = 6;
// pyxel-core settings.rs FONT_DATA: one 4 x 6 glyph per character from
// ' ' to DEL, packed MSB first in the low 24 bits (bit 23 = top left).
const FONT: I32[] = [
  0x000000, 0x444040, 0xaa0000, 0xaeaea0, 0x6c6c40, 0x824820, 0x4a4ac0, 0x440000, 0x244420, 0x844480, 0xa4e4a0,
  0x04e400, 0x000480, 0x00e000, 0x000040, 0x224880, 0x6aaac0, 0x4c4440, 0xc248e0, 0xc242c0, 0xaae220, 0xe8c2c0,
  0x68eae0, 0xe24880, 0xeaeae0, 0xeae2c0, 0x040400, 0x040480, 0x248420, 0x0e0e00, 0x842480, 0xe24040, 0x4aa860,
  0x4aeaa0, 0xcacac0, 0x688860, 0xcaaac0, 0xe8e8e0, 0xe8e880, 0x68ea60, 0xaaeaa0, 0xe444e0, 0x222a40, 0xaacaa0,
  0x8888e0, 0xaeeaa0, 0xcaaaa0, 0x4aaa40, 0xcac880, 0x4aae60, 0xcaeca0, 0x6842c0, 0xe44440, 0xaaaa60, 0xaaaa40,
  0xaaeea0, 0xaa4aa0, 0xaa4440, 0xe248e0, 0x644460, 0x884220, 0xc444c0, 0x4a0000, 0x0000e0, 0x840000, 0x06aa60,
  0x8caac0, 0x068860, 0x26aa60, 0x06ac60, 0x24e440, 0x06ae24, 0x8caaa0, 0x404440, 0x2022a4, 0x8acca0, 0xc444e0,
  0x0eeea0, 0x0caaa0, 0x04aa40, 0x0caac8, 0x06aa62, 0x068880, 0x06c6c0, 0x4e4460, 0x0aaa60, 0x0aaa40, 0x0aaee0,
  0x0a44a0, 0x0aa624, 0x0e24e0, 0x64c460, 0x444440, 0xc464c0, 0x6c0000, 0xeeeee0,
];

/** Draws one glyph; the screen path writes directly when the glyph is inside the clip rectangle. */
/** @iwram */
function glyph(s: I32, x: I32, y: I32, bits: I32, value: I32): void {
  const inside = x >= clipX1[s] && x + 3 <= clipX2[s] && y >= clipY1[s] && y + 5 <= clipY2[s];
  if (s === SCREEN && inside && ditherMask[s] === ALL_PIXELS) {
    const color = u8(value);
    for (let fy = 0; fy < 6; fy++) {
      const line = (bits >> (20 - fy * 4)) & 15,
        at = (y + fy) * width + x;
      if ((line & 8) !== 0) screen[at] = color;
      if ((line & 4) !== 0) screen[at + 1] = color;
      if ((line & 2) !== 0) screen[at + 2] = color;
      if ((line & 1) !== 0) screen[at + 3] = color;
    }
    return;
  }
  for (let fy = 0; fy < 6; fy++)
    for (let fx = 0; fx < 4; fx++) if (((bits >> (23 - fy * 4 - fx)) & 1) !== 0) put(s, x + fx, y + fy, value);
}

/** Draws text with the built-in 4 x 6 font; "\n" starts a new line. */
export function text(s: I32, x: I32, y: I32, str: string, col: I32): void {
  writable(s);
  const value = mapped(s, col);
  let cx = x - camX[s],
    cy = y - camY[s];
  const left = cx;
  for (const code of codePoints(str)) {
    if (code === 10) {
      cx = left;
      cy += FONT_HEIGHT;
      continue;
    }
    if (code < 32 || code > 127) continue;
    glyph(s, cx, cy, FONT[code - 32], value);
    cx += FONT_WIDTH;
  }
}

/** Width in pixels of the widest line of text. */
export function textWidth(str: string): I32 {
  let widest = 0,
    current = 0;
  for (const code of codePoints(str)) {
    if (code === 10) {
      current = 0;
      continue;
    }
    if (code >= 32 && code <= 127) current += FONT_WIDTH;
    if (current > widest) widest = current;
  }
  return widest;
}
