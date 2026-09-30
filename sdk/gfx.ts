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
  fillRect,
  f32,
  i16,
  i32,
  idiv,
  len,
  pop,
  push,
  sin as stdSin,
  u8,
  u16,
  type f32 as F32,
  type i16 as I16,
  type i32 as I32,
  type u8 as U8,
  type u16 as U16,
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
/** Every color mapped to itself, which resetColorMap() copies; made at run time to stay out of IWRAM. */
let identityMap: U8[] = [];
let palIdentity: boolean[] = [true, true, true, true];
/** Bit (y & 3) * 4 + (x & 3) set where a pixel may be written. */
let ditherMask: I32[] = [ALL_PIXELS, ALL_PIXELS, ALL_PIXELS, ALL_PIXELS];
/** Image banks copied into RAM by their first write; empty while unchanged. */
let banks: U8[][] = [[], [], []];
/**
 * The color of each 8 x 8 cell of the image banks (32 x 32 cells a bank) when
 * all its pixels share it, MIXED when they do not, UNKNOWN until measured.
 * Tilemap drawing skips cells of its transparent color and fills the others.
 */
const MIXED: I32 = 256;
const UNKNOWN: I32 = 257;
let cellColors: I16[] = fill(3 * 1024, i16(UNKNOWN));
/** Banks written since their cell colors were last reset. */
let cellsStale: boolean[] = [false, false, false];

export function resetSurfaces(): void {
  if (len(identityMap) === 0) {
    identityMap = fill(256, u8(0));
    for (let c = 0; c < 256; c++) identityMap[c] = u8(c);
  }
  for (let s = 0; s < 4; s++) {
    resetColorMap(s);
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
  copyRange(palMap, s * 256, identityMap, 0, 256);
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
  if (s >= SCREEN) return;
  cellsStale[s] = true;
  if (len(banks[s]) === 0) {
    banks[s] = fill(BANK_BYTES, u8(0));
    copyRange(banks[s], 0, IMAGES, s * BANK_BYTES, BANK_BYTES);
  }
}

/** Forgets the cell colors of bank img if it was written since they were measured. */
function refreshCells(img: I32): void {
  if (!cellsStale[img]) return;
  fillRange(cellColors, img * 1024, img * 1024 + 1024, i16(UNKNOWN));
  cellsStale[img] = false;
}

/** Measures and records the shared color of cell (cx, cy) of bank img, or MIXED. */
function measureCell(img: I32, cx: I32, cy: I32): I32 {
  const x = cx * 8,
    y = cy * 8,
    first = read(img, x, y);
  let color = first;
  for (let j = 0; j < 8 && color === first; j++)
    for (let i = 0; i < 8; i++)
      if (read(img, x + i, y + j) !== first) {
        color = MIXED;
        break;
      }
  cellColors[img * 1024 + cy * 32 + cx] = i16(color);
  return color;
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

/**
 * put() for the screen without dither: outlines cut by the clip rectangle
 * plot their pixels here rather than with a call into IWRAM each.
 */
function plot(x: I32, y: I32, color: U8): void {
  if (x >= clipX1[SCREEN] && x <= clipX2[SCREEN] && y >= clipY1[SCREEN] && y <= clipY2[SCREEN])
    screen[y * width + x] = color;
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
    ditherRow(s, left, right, y, value);
  } else if (s === SCREEN) {
    fillRange(screen, y * width + left, y * width + right + 1, u8(value));
  } else {
    fillRange(banks[s], y * IMAGE_SIZE + left, y * IMAGE_SIZE + right + 1, u8(value));
  }
}

/**
 * row() through dither, which lets the same pixels through every 4 columns:
 * each of the first 4 pixels it lets through starts a fill of every fourth pixel.
 */
function ditherRow(s: I32, left: I32, right: I32, y: I32, value: I32): void {
  const bits = ditherMask[s] >> ((y & 3) << 2);
  for (let x = left; x < left + 4 && x <= right; x++)
    if ((bits & (1 << (x & 3))) !== 0) {
      if (s === SCREEN) fillRect(screen, y * width + x, 4, 1, ((right - x) >> 2) + 1, u8(value));
      else fillRect(banks[s], y * IMAGE_SIZE + x, 4, 1, ((right - x) >> 2) + 1, u8(value));
    }
}

/** Vertical run from y1 to y2 inclusive on column x, clipped; value is mapped. */
/** @iwram */
function column(s: I32, y1: I32, y2: I32, x: I32, value: I32): void {
  if (x < clipX1[s] || x > clipX2[s]) return;
  const top = y1 < clipY1[s] ? clipY1[s] : y1;
  const bottom = y2 > clipY2[s] ? clipY2[s] : y2;
  if (top > bottom) return;
  // A column is a one pixel wide rectangle.
  if (ditherMask[s] !== ALL_PIXELS) {
    for (let y = top; y <= bottom; y++) put(s, x, y, value);
  } else if (s === SCREEN) {
    fillRect(screen, top * width + x, width, 1, bottom - top + 1, u8(value));
  } else {
    fillRect(banks[s], top * IMAGE_SIZE + x, IMAGE_SIZE, 1, bottom - top + 1, u8(value));
  }
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
  // On the screen without dither, a line inside the clip rectangle is
  // written directly and one cut by it goes through plot().
  if (!exact && s === SCREEN && ditherMask[s] === ALL_PIXELS) {
    const color = u8(value),
      half = 1 << 19;
    const low = minor < 0 ? minorStart + minor : minorStart,
      high = minor < 0 ? minorStart : minorStart + minor;
    const inside = horizontal
      ? majorStart >= clipX1[s] && majorStart + major <= clipX2[s] && low >= clipY1[s] && high <= clipY2[s]
      : majorStart >= clipY1[s] && majorStart + major <= clipY2[s] && low >= clipX1[s] && high <= clipX2[s];
    for (let i = 0; i <= major; i++) {
      const step = slope * i,
        offset = step >= 0 ? (step + half) >> 20 : -((-step + half) >> 20);
      const px = horizontal ? majorStart + i : minorStart + offset,
        py = horizontal ? minorStart + offset : majorStart + i;
      if (inside) screen[py * width + px] = color;
      else plot(px, py, color);
    }
    return;
  }
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
  if (ditherMask[s] !== ALL_PIXELS) {
    for (let j = top; j < top + h; j++) row(s, left, left + w - 1, j, value);
    return;
  }
  const x1 = larger(left, clipX1[s]),
    y1 = larger(top, clipY1[s]),
    x2 = left + w - 1 < clipX2[s] ? left + w - 1 : clipX2[s],
    y2 = top + h - 1 < clipY2[s] ? top + h - 1 : clipY2[s];
  if (x1 > x2 || y1 > y2) return;
  if (s === SCREEN) fillRect(screen, y1 * width + x1, width, x2 - x1 + 1, y2 - y1 + 1, u8(value));
  else fillRect(banks[s], y1 * IMAGE_SIZE + x1, IMAGE_SIZE, x2 - x1 + 1, y2 - y1 + 1, u8(value));
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

// Circles are ellipseArea(0, 0, 2r, 2r, xi) for xi = 0..r: column xi spans
// -span..span, where span depends on r and xi only, so small radii keep it.
const CIRCLE_CACHE: I32 = 64;
/** circleSpan(r, xi) at (r * (r + 1)) / 2 + xi for r < CIRCLE_CACHE, -1 until computed. */
let circleSpans: I16[] = [];

/** The half-height of column xi of a circle of radius r, as ellipseArea() computes it. */
function circleSpan(r: I32, xi: I32): I32 {
  if (r >= CIRCLE_CACHE) {
    ellipseArea(0, 0, 2 * r, 2 * r, xi);
    return areaY2;
  }
  if (len(circleSpans) === 0) circleSpans = fill((CIRCLE_CACHE * (CIRCLE_CACHE + 1)) >> 1, i16(-1));
  const at = ((r * (r + 1)) >> 1) + xi;
  if (circleSpans[at] < 0) {
    ellipseArea(0, 0, 2 * r, 2 * r, xi);
    circleSpans[at] = i16(areaY2);
  }
  return i32(circleSpans[at]);
}

export function circ(s: I32, x: I32, y: I32, r: I32, col: I32): void {
  if (r < 0) return;
  writable(s);
  const value = mapped(s, col),
    cx = x - camX[s],
    cy = y - camY[s];
  // canvas.rs fills column xi and row xi for each xi. Spans shrink as xi
  // grows, so their union is one run per row k: as wide as row k and the
  // columns 0..m that reach it. Inside the screen's clip rectangle the runs
  // are filled directly.
  const inside =
    s === SCREEN &&
    ditherMask[s] === ALL_PIXELS &&
    cx - r >= clipX1[s] &&
    cx + r <= clipX2[s] &&
    cy - r >= clipY1[s] &&
    cy + r <= clipY2[s];
  const color = u8(value);
  let m = r;
  for (let k = 0; k <= r; k++) {
    while (m > 0 && circleSpan(r, m) < k) m--;
    const span = circleSpan(r, k),
      half = span > m ? span : m;
    if (inside) {
      fillRange(screen, (cy - k) * width + cx - half, (cy - k) * width + cx + half + 1, color);
      if (k > 0) fillRange(screen, (cy + k) * width + cx - half, (cy + k) * width + cx + half + 1, color);
    } else {
      row(s, cx - half, cx + half, cy - k, value);
      if (k > 0) row(s, cx - half, cx + half, cy + k, value);
    }
  }
}

export function circb(s: I32, x: I32, y: I32, r: I32, col: I32): void {
  if (r < 0) return;
  writable(s);
  const value = mapped(s, col),
    cx = x - camX[s],
    cy = y - camY[s];
  // A circle inside the screen's clip rectangle is written directly, one
  // partly inside it through plot().
  if (s === SCREEN && ditherMask[s] === ALL_PIXELS) {
    const color = u8(value);
    if (cx - r >= clipX1[s] && cx + r <= clipX2[s] && cy - r >= clipY1[s] && cy + r <= clipY2[s]) {
      for (let xi = 0; xi <= r; xi++) {
        const span = circleSpan(r, xi);
        screen[(cy - span) * width + cx - xi] = color;
        screen[(cy - span) * width + cx + xi] = color;
        screen[(cy + span) * width + cx - xi] = color;
        screen[(cy + span) * width + cx + xi] = color;
        screen[(cy - xi) * width + cx - span] = color;
        screen[(cy + xi) * width + cx - span] = color;
        screen[(cy - xi) * width + cx + span] = color;
        screen[(cy + xi) * width + cx + span] = color;
      }
      return;
    }
    for (let xi = 0; xi <= r; xi++) {
      const span = circleSpan(r, xi);
      plot(cx - xi, cy - span, color);
      plot(cx + xi, cy - span, color);
      plot(cx - xi, cy + span, color);
      plot(cx + xi, cy + span, color);
      plot(cx - span, cy - xi, color);
      plot(cx - span, cy + xi, color);
      plot(cx + span, cy - xi, color);
      plot(cx + span, cy + xi, color);
    }
    return;
  }
  for (let xi = 0; xi <= r; xi++) {
    const span = circleSpan(r, xi);
    put(s, cx - xi, cy - span, value);
    put(s, cx + xi, cy - span, value);
    put(s, cx - xi, cy + span, value);
    put(s, cx + xi, cy + span, value);
    put(s, cx - span, cy - xi, value);
    put(s, cx - span, cy + xi, value);
    put(s, cx + span, cy - xi, value);
    put(s, cx + span, cy + xi, value);
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

/**
 * Copies a w x h block of image `img` from si to the screen at di, skipping
 * `key` (-1 skips none). The source advances by `step` (1, or -1 to read right
 * to left) along a row and by `stride` between rows. A bank copied to RAM is
 * read there, others from cartridge data.
 */
/** @iwram */
function blockToScreen(img: I32, si: I32, di: I32, w: I32, h: I32, step: I32, stride: I32, key: I32): void {
  const inRam = len(banks[img]) > 0;
  // Row by row: blits have long rows, which copyRange loops over more tightly than copyRect.
  for (let j = 0; j < h; j++) {
    const from = si + j * stride,
      to = di + j * width;
    if (step > 0 && inRam && key < 0) copyRange(screen, to, banks[img], from, w);
    else if (step > 0 && inRam) copyRange(screen, to, banks[img], from, w, u8(key));
    else if (step > 0 && key < 0) copyRange(screen, to, IMAGES, img * BANK_BYTES + from, w);
    else if (step > 0) copyRange(screen, to, IMAGES, img * BANK_BYTES + from, w, u8(key));
    else
      for (let i = 0; i < w; i++) {
        const c = inRam ? banks[img][from - i] : IMAGES[img * BANK_BYTES + from - i];
        if (i32(c) !== key) screen[to + i] = c;
      }
  }
}

/**
 * blockToScreen through the screen's draw palette, for blits while pal()
 * maps colors: `key` is compared with the source color before mapping.
 */
/** @iwram */
function blockToScreenMapped(img: I32, si: I32, di: I32, w: I32, h: I32, step: I32, stride: I32, key: I32): void {
  if (len(banks[img]) > 0) {
    bankToScreenMapped(img, si, di, w, h, step, stride, key);
    return;
  }
  const map = SCREEN * 256;
  let from = img * BANK_BYTES + si,
    to = di;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = i32(IMAGES[from + step * i]);
      if (c !== key) screen[to + i] = palMap[map + c];
    }
    from += stride;
    to += width;
  }
}

/** blockToScreenMapped from a bank copied to RAM. */
function bankToScreenMapped(img: I32, si: I32, di: I32, w: I32, h: I32, step: I32, stride: I32, key: I32): void {
  const map = SCREEN * 256;
  for (let j = 0; j < h; j++) {
    const from = si + j * stride,
      to = di + j * width;
    for (let i = 0; i < w; i++) {
      const c = i32(banks[img][from + step * i]);
      if (c !== key) screen[to + i] = palMap[map + c];
    }
  }
}

/** A color key the block copies can skip: colors are bytes, so larger keys match nothing. */
function blockKey(key: I32): I32 {
  return key > 255 ? -1 : key;
}

/**
 * A row from any source with key, flip and draw palette, for blits through
 * dither or into an image bank; blits to the screen take the block copies.
 */
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
  if (s === SCREEN && img < SCREEN && ditherMask[s] === ALL_PIXELS) {
    const si = (copySrcY + copyOffY) * IMAGE_SIZE + copySrcX + copyOffX,
      di = copyDstY * width + copyDstX;
    if (palIdentity[s]) blockToScreen(img, si, di, copyW, copyH, copySignX, copySignY * IMAGE_SIZE, blockKey(key));
    else blockToScreenMapped(img, si, di, copyW, copyH, copySignX, copySignY * IMAGE_SIZE, blockKey(key));
    return;
  }
  for (let yi = 0; yi < copyH; yi++)
    rowGeneric(
      s,
      img,
      copyDstX,
      copyDstY + yi,
      copySrcX + copyOffX,
      copySrcY + copySignY * yi + copyOffY,
      copySignX,
      copyW,
      key,
    );
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
/**
 * Tilemaps are read from the cartridge in chunks of 16 x 16 tiles; the first
 * write to a chunk copies it into RAM, where it is read and written from
 * then on. chunkOf holds, for each tilemap m and chunk (cx, cy) at
 * m << 8 | cy << 4 | cx, its index in chunks or -1, and stays empty until
 * the first write. A chunk holds its 256 tiles, then the number of places in
 * chunkOf that share it: a tilemap blt of whole chunks shares them, and a
 * write to a shared chunk copies it first. Chunks no place uses are reused;
 * writes needing more than MAX_CHUNKS chunks are dropped.
 */
const MAX_CHUNKS: I32 = 256;
const CHUNK_USERS: I32 = 256;
let chunkOf: I16[] = [];
let chunks: U16[][] = [];
let tilemapSources: I32[] = [0, 0, 0, 0, 0, 0, 0, 0];

export function resetTilemaps(): void {
  for (let m = 0; m < 8; m++) tilemapSources[m] = m < len(TILEMAP_IMAGES) ? TILEMAP_IMAGES[m] : 0;
}

/** A tile value: image tile column in bits 0-7, tile row in bits 8-15. */
export function tile(tx: I32, ty: I32): I32 {
  return (tx & 255) | ((ty & 255) << 8);
}

/**
 * The tile at (x, y) of tilemap m, in tiles; outside the map it is tile(0, 0).
 * Out of IWRAM: tilesToScreen reads unchanged tiles itself.
 */
export function tget(m: I32, x: I32, y: I32): I32 {
  if (x < 0 || y < 0 || x >= TILEMAP_SIZE || y >= TILEMAP_SIZE) return 0;
  if (len(chunkOf) > 0) {
    const chunk = i32(chunkOf[(m << 8) | ((y >> 4) << 4) | (x >> 4)]);
    if (chunk >= 0) return i32(chunks[chunk][((y & 15) << 4) | (x & 15)]);
  }
  const at = m * TILEMAP_BYTES + (y * TILEMAP_SIZE + x) * 2;
  return i32(TILEMAPS[at]) | (i32(TILEMAPS[at + 1]) << 8);
}

/** A chunk no place uses, or a new one; -1 past MAX_CHUNKS. Its tiles are left as they are. */
function freeChunk(): I32 {
  for (let c = 0; c < len(chunks); c++) if (chunks[c][CHUNK_USERS] === u16(0)) return c;
  if (len(chunks) >= MAX_CHUNKS) return -1;
  push(chunks, fill(CHUNK_USERS + 1, u16(0)));
  return len(chunks) - 1;
}

/** Makes place `at` of chunkOf use chunk c (or none, -1), releasing the chunk it used. */
function useChunk(at: I32, c: I32): void {
  const old = i32(chunkOf[at]);
  if (old >= 0) chunks[old][CHUNK_USERS] = u16(i32(chunks[old][CHUNK_USERS]) - 1);
  if (c >= 0) chunks[c][CHUNK_USERS] = u16(i32(chunks[c][CHUNK_USERS]) + 1);
  chunkOf[at] = i16(c);
}

/**
 * The index in chunks of chunk (cx, cy) of tilemap m, made its own: copied
 * into RAM on first use and from a shared chunk on the first write after,
 * except when the caller overwrites all its tiles; -1 past MAX_CHUNKS.
 */
function writableChunk(m: I32, cx: I32, cy: I32, overwritten: boolean): I32 {
  if (len(chunkOf) === 0) chunkOf = fill(8 * 256, i16(-1));
  const at = (m << 8) | (cy << 4) | cx,
    shared = i32(chunkOf[at]);
  if (shared >= 0 && chunks[shared][CHUNK_USERS] === u16(1)) return shared;
  const chunk = freeChunk();
  if (chunk < 0) return -1;
  useChunk(at, chunk);
  if (overwritten) return chunk;
  if (shared >= 0) {
    copyRange(chunks[chunk], 0, chunks[shared], 0, 256);
    return chunk;
  }
  for (let j = 0; j < 16; j++) {
    const from = m * TILEMAP_BYTES + ((cy * 16 + j) * TILEMAP_SIZE + cx * 16) * 2;
    for (let i = 0; i < 16; i++)
      chunks[chunk][j * 16 + i] = u16(i32(TILEMAPS[from + i * 2]) | (i32(TILEMAPS[from + i * 2 + 1]) << 8));
  }
  return chunk;
}

export function tset(m: I32, x: I32, y: I32, value: I32): void {
  if (x < 0 || y < 0 || x >= TILEMAP_SIZE || y >= TILEMAP_SIZE) return;
  const chunk = writableChunk(m, x >> 4, y >> 4, false);
  if (chunk >= 0) chunks[chunk][((y & 15) << 4) | (x & 15)] = u16(value);
}

/**
 * pyxel.tilemaps[m].blt(x, y, src, u, v, w, h, tilekey): copies the w x h
 * tiles at (u, v) of tilemap src to (x, y) of tilemap m, clipped to both
 * maps (tilemaps have no camera or clip here). Negative w or h flips; source
 * tiles equal to key are left out, and -1 leaves none out. A copy within one
 * tilemap reads its whole source before writing.
 */
export function tilemapBlt(m: I32, x: I32, y: I32, src: I32, u: I32, v: I32, w: I32, h: I32, key: I32): void {
  const aw = w < 0 ? -w : w,
    ah = h < 0 ? -h : h;
  // Destination columns x + first .. x + last, whose source columns are in the map too.
  const first = larger(larger(-x, w < 0 ? u + aw - TILEMAP_SIZE : -u), 0);
  const lastDst = TILEMAP_SIZE - 1 - x < aw - 1 ? TILEMAP_SIZE - 1 - x : aw - 1;
  const lastSrc = w < 0 ? u + aw - 1 : TILEMAP_SIZE - 1 - u;
  const last = lastDst < lastSrc ? lastDst : lastSrc;
  // Destination rows y + top .. y + bottom likewise.
  const top = larger(larger(-y, h < 0 ? v + ah - TILEMAP_SIZE : -v), 0);
  const bottomDst = TILEMAP_SIZE - 1 - y < ah - 1 ? TILEMAP_SIZE - 1 - y : ah - 1;
  const bottomSrc = h < 0 ? v + ah - 1 : TILEMAP_SIZE - 1 - v;
  const bottom = bottomDst < bottomSrc ? bottomDst : bottomSrc;
  if (first > last || top > bottom) return;
  const self = src === m;
  // Whole chunks inside both maps share the source's.
  const aligned = w > 0 && h > 0 && ((x | y | u | v | w | h) & 15) === 0;
  if (!self && key < 0 && aligned && first === 0 && last === w - 1 && top === 0 && bottom === h - 1) {
    copyChunks(m, x >> 4, y >> 4, src, u >> 4, v >> 4, w >> 4, h >> 4);
    return;
  }
  // Each destination row takes a run of n source tiles from column sx, reversed when flipped.
  const n = last - first + 1,
    sx = w < 0 ? u + aw - 1 - last : u + first;
  const tiles: U16[] = fill(self ? n * ah : n, u16(0));
  // A copy within one tilemap reads every source row in a first pass; others read each row as they write it.
  for (let pass = self ? 0 : 1; pass < 2; pass++)
    for (let j = 0; j < ah; j++) {
      const sy = v + (h < 0 ? ah - 1 - j : j),
        ty = y + j,
        at = self ? j * n : 0;
      if (sy < 0 || sy >= TILEMAP_SIZE || ty < 0 || ty >= TILEMAP_SIZE) continue;
      if (pass === 0 || !self) {
        for (let i = 0; i < n;) {
          const tx = sx + i,
            run = 16 - (tx & 15) < n - i ? 16 - (tx & 15) : n - i;
          const chunk = len(chunkOf) > 0 ? i32(chunkOf[(src << 8) | ((sy >> 4) << 4) | (tx >> 4)]) : -1;
          if (chunk >= 0) {
            copyRange(tiles, at + i, chunks[chunk], ((sy & 15) << 4) | (tx & 15), run);
          } else {
            const from = src * TILEMAP_BYTES + (sy * TILEMAP_SIZE + tx) * 2;
            for (let k = 0; k < run; k++)
              tiles[at + i + k] = u16(i32(TILEMAPS[from + k * 2]) | (i32(TILEMAPS[from + k * 2 + 1]) << 8));
          }
          i += run;
        }
        if (w < 0)
          for (let k = 0; k < n >> 1; k++) {
            const t = tiles[at + k];
            tiles[at + k] = tiles[at + n - 1 - k];
            tiles[at + n - 1 - k] = t;
          }
      }
      if (pass === 0) continue;
      // Write the run chunk by chunk; chunks the copy covers whole need no cartridge tiles.
      for (let i = 0; i < n;) {
        const tx = x + first + i,
          run = 16 - (tx & 15) < n - i ? 16 - (tx & 15) : n - i;
        const cx = tx >> 4,
          cy = ty >> 4;
        const whole =
          key < 0 &&
          cx * 16 >= x + first &&
          cx * 16 + 15 <= x + last &&
          cy * 16 >= y + top &&
          cy * 16 + 15 <= y + bottom;
        const chunk = writableChunk(m, cx, cy, whole);
        if (chunk >= 0) {
          const to = ((ty & 15) << 4) | (tx & 15);
          if (key < 0 || key > 0xffff) copyRange(chunks[chunk], to, tiles, at + i, run);
          else copyRange(chunks[chunk], to, tiles, at + i, run, u16(key));
        }
        i += run;
      }
    }
}

/**
 * tilemapBlt of whole chunks: w x h chunks from chunk (u, v) of tilemap src
 * to chunk (x, y) of tilemap m, which share the source's chunks in RAM.
 */
function copyChunks(m: I32, x: I32, y: I32, src: I32, u: I32, v: I32, w: I32, h: I32): void {
  if (len(chunkOf) === 0) chunkOf = fill(8 * 256, i16(-1));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const from = i32(chunkOf[(src << 8) | ((v + j) << 4) | (u + i)]),
        at = (m << 8) | ((y + j) << 4) | (x + i);
      if (from >= 0) {
        if (i32(chunkOf[at]) !== from) useChunk(at, from);
        continue;
      }
      const to = writableChunk(m, x + i, y + j, true);
      if (to < 0) continue;
      for (let ty = 0; ty < 16; ty++) {
        const at = src * TILEMAP_BYTES + (((v + j) * 16 + ty) * TILEMAP_SIZE + (u + i) * 16) * 2;
        for (let tx = 0; tx < 16; tx++)
          chunks[to][ty * 16 + tx] = u16(i32(TILEMAPS[at + tx * 2]) | (i32(TILEMAPS[at + tx * 2 + 1]) << 8));
      }
    }
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
  if (s === SCREEN && img < SCREEN && copySignX > 0 && copySignY > 0 && ditherMask[s] === ALL_PIXELS) {
    refreshCells(img);
    if (palIdentity[s]) tilesToScreen(m, img, blockKey(key));
    else tilesToScreenMapped(m, img, blockKey(key));
    return;
  }
  for (let yi = 0; yi < copyH; yi++) {
    const ty = copySrcY + copySignY * yi + copyOffY;
    for (let xi = 0; xi < copyW; xi++) {
      const tx = copySrcX + copySignX * xi + copyOffX;
      const value = tget(m, tx >> 3, ty >> 3);
      const ix = (value & 255) * 8 + (tx & 7),
        iy = (value >> 8) * 8 + (ty & 7);
      if (ix < IMAGE_SIZE && iy < IMAGE_SIZE) {
        const c = read(img, ix, iy);
        if (c !== key) put(s, copyDstX + xi, copyDstY + yi, mapped(s, c));
      }
    }
  }
}

/**
 * The copy window of an unflipped bltm to the screen, one block per tile.
 * Runs from IWRAM: single-color cells are filled here and mixed ones copied
 * by blockToScreen, a call per cell that costs less than the IWRAM a copy
 * written out here for each source and color key would take. measureCell
 * and tget, needed for unmeasured cells and changed tiles only, stay in ROM.
 */
/** @iwram */
function tilesToScreen(m: I32, img: I32, key: I32): void {
  const right = copySrcX + copyW - 1,
    bottom = copySrcY + copyH - 1;
  for (let ty = copySrcY >> 3; ty <= bottom >> 3; ty++) {
    const top = copySrcY > ty * 8 ? copySrcY - ty * 8 : 0,
      rows = (bottom - ty * 8 < 7 ? bottom - ty * 8 : 7) - top + 1;
    const rowStart = (copyDstY + ty * 8 + top - copySrcY) * width + copyDstX - copySrcX;
    for (let tx = copySrcX >> 3; tx <= right >> 3; tx++) {
      // copyArea keeps (tx, ty) inside the map, so only tiles written at run time need tget.
      const at = m * TILEMAP_BYTES + (ty * TILEMAP_SIZE + tx) * 2;
      const value = len(chunkOf) > 0 ? tget(m, tx, ty) : i32(TILEMAPS[at]) | (i32(TILEMAPS[at + 1]) << 8);
      // Tiles name 8 x 8 cells of a 256 x 256 image; others draw nothing.
      const cx = value & 255,
        cy = value >> 8;
      if (cx >= 32 || cy >= 32) continue;
      let color = i32(cellColors[img * 1024 + cy * 32 + cx]);
      if (color === UNKNOWN) color = measureCell(img, cx, cy);
      if (color === key) continue;
      const left = copySrcX > tx * 8 ? copySrcX - tx * 8 : 0,
        cols = (right - tx * 8 < 7 ? right - tx * 8 : 7) - left + 1;
      const di = rowStart + tx * 8 + left,
        si = (cy * 8 + top) * IMAGE_SIZE + cx * 8 + left;
      if (color !== MIXED) fillRect(screen, di, width, cols, rows, u8(color));
      else blockToScreen(img, si, di, cols, rows, 1, IMAGE_SIZE, key);
    }
  }
}

/**
 * tilesToScreen through the screen's draw palette, for bltm while pal() maps
 * colors. It stays out of IWRAM: pal() during a tilemap draw is rare.
 */
function tilesToScreenMapped(m: I32, img: I32, key: I32): void {
  const right = copySrcX + copyW - 1,
    bottom = copySrcY + copyH - 1;
  for (let ty = copySrcY >> 3; ty <= bottom >> 3; ty++) {
    const top = copySrcY > ty * 8 ? copySrcY - ty * 8 : 0,
      rows = (bottom - ty * 8 < 7 ? bottom - ty * 8 : 7) - top + 1;
    const rowStart = (copyDstY + ty * 8 + top - copySrcY) * width + copyDstX - copySrcX;
    for (let tx = copySrcX >> 3; tx <= right >> 3; tx++) {
      const value = tget(m, tx, ty);
      const cx = value & 255,
        cy = value >> 8;
      if (cx >= 32 || cy >= 32) continue;
      let color = i32(cellColors[img * 1024 + cy * 32 + cx]);
      if (color === UNKNOWN) color = measureCell(img, cx, cy);
      if (color === key) continue;
      const left = copySrcX > tx * 8 ? copySrcX - tx * 8 : 0,
        cols = (right - tx * 8 < 7 ? right - tx * 8 : 7) - left + 1;
      const di = rowStart + tx * 8 + left,
        si = (cy * 8 + top) * IMAGE_SIZE + cx * 8 + left;
      if (color !== MIXED) fillRect(screen, di, width, cols, rows, palMap[SCREEN * 256 + color]);
      else blockToScreenMapped(img, si, di, cols, rows, 1, IMAGE_SIZE, key);
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

/** Draws the part of one glyph inside the clip rectangle, through dither if it is set. */
function glyphClipped(s: I32, x: I32, y: I32, bits: I32, value: I32): void {
  if (s !== SCREEN || ditherMask[s] !== ALL_PIXELS) {
    for (let fy = 0; fy < 6; fy++)
      for (let fx = 0; fx < 4; fx++) if (((bits >> (23 - fy * 4 - fx)) & 1) !== 0) put(s, x + fx, y + fy, value);
    return;
  }
  // Visible glyph rows first..last and columns left..right.
  const first = y < clipY1[s] ? clipY1[s] - y : 0,
    last = y + 5 > clipY2[s] ? clipY2[s] - y : 5,
    left = clipX1[s] - x,
    right = clipX2[s] - x;
  const color = u8(value);
  for (let fy = first; fy <= last; fy++) {
    const line = (bits >> (20 - fy * 4)) & 15,
      at = (y + fy) * width + x;
    if (line === 0) continue;
    if ((line & 8) !== 0 && left <= 0 && right >= 0) screen[at] = color;
    if ((line & 4) !== 0 && left <= 1 && right >= 1) screen[at + 1] = color;
    if ((line & 2) !== 0 && left <= 2 && right >= 2) screen[at + 2] = color;
    if ((line & 1) !== 0 && left <= 3 && right >= 3) screen[at + 3] = color;
  }
}

/** Writes the set pixels of a glyph, bit 23 being its top left, at screen index `at`. */
/** @iwram */
function glyphToScreen(at: I32, bits: I32, color: U8): void {
  for (let fy = 0; fy < 6; fy++) {
    const line = (bits >> (20 - fy * 4)) & 15,
      row = at + fy * width;
    if ((line & 8) !== 0) screen[row] = color;
    if ((line & 4) !== 0) screen[row + 1] = color;
    if ((line & 2) !== 0) screen[row + 2] = color;
    if ((line & 1) !== 0) screen[row + 3] = color;
  }
}

/** A mask of the glyph rows at y that lie in top..bottom, bit 23 being the top left pixel. */
/** @iwram */
function rowsShown(y: I32, top: I32, bottom: I32): I32 {
  const first = y < top ? top - y : 0,
    last = y + 5 > bottom ? bottom - y : 5;
  return ((1 << ((last - first + 1) * 4)) - 1) << ((5 - last) * 4);
}

/** The code points of the string text() draws, kept here so drawText() reads them in place. */
let textCodes: I32[] = [];

/**
 * Draws textCodes at (x, y) of surface s in an already mapped color. On the
 * screen, glyphs whose columns are inside the clip rectangle are written
 * directly; other glyphs partly inside it go through glyphClipped() and
 * those wholly outside are skipped.
 */
/** @iwram */
function drawText(s: I32, x: I32, y: I32, value: I32): void {
  const direct = s === SCREEN && ditherMask[s] === ALL_PIXELS;
  const left = clipX1[s],
    top = clipY1[s],
    right = clipX2[s],
    bottom = clipY2[s];
  const color = u8(value);
  let cx = x,
    cy = y;
  for (let i = 0; i < len(textCodes); i++) {
    const code = textCodes[i];
    if (code === 10) {
      cx = x;
      cy += FONT_HEIGHT;
      continue;
    }
    if (code < 32 || code > 127) continue;
    const bits = FONT[code - 32];
    if (direct && cx >= left && cx + 3 <= right && cy + 5 >= top && cy <= bottom) {
      // Rows outside the clip rectangle are masked off, so glyphs cut by its
      // top or bottom are written directly too.
      glyphToScreen(cy * width + cx, cy >= top && cy + 5 <= bottom ? bits : bits & rowsShown(cy, top, bottom), color);
    } else if (cx + 3 >= left && cx <= right && cy + 5 >= top && cy <= bottom) {
      glyphClipped(s, cx, cy, bits, value);
    }
    cx += FONT_WIDTH;
  }
}

/** Draws text with the built-in 4 x 6 font; "\n" starts a new line. */
export function text(s: I32, x: I32, y: I32, str: string, col: I32): void {
  writable(s);
  textCodes = codePoints(str);
  drawText(s, x - camX[s], y - camY[s], mapped(s, col));
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
