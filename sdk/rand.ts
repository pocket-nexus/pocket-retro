/** Random numbers (xorshift32) and Perlin noise for rndi, rndf and noise. */
import { f32, fill, floor, i32, len, u32, type f32 as F32, type i32 as I32 } from "@pocketjs/framework/solid/std";

let state: I32 = 0x2545f491;

export function seed(value: I32): void {
  state = value === 0 ? 0x2545f491 : value;
}

/** Next 32 random bits. */
export function next(): I32 {
  let x = state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state = x;
  return x;
}

/** A uniform integer in [a, b] inclusive, in either argument order. */
export function rndi(a: I32, b: I32): I32 {
  const lo = a < b ? a : b,
    hi = a < b ? b : a;
  const span = hi - lo + 1;
  if (span <= 0) return lo + (next() & 0x7fffffff);
  return lo + i32(u32(next()) % u32(span));
}

/** A uniform float in [a, b], in either argument order. */
export function rndf(a: F32, b: F32): F32 {
  const lo = a < b ? a : b,
    hi = a < b ? b : a;
  return lo + (hi - lo) * (f32(next() >>> 8) / f32(16777215));
}

// Improved Perlin noise over a seeded permutation of 0-255.
/** Allocated by the first noiseSeed() so games without noise keep the RAM. */
let perm: I32[] = [];

export function noiseSeed(value: I32): void {
  const saved = state;
  seed(value);
  perm = fill(512, 0);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    // An index 0..i from 16 random bits, without a division (100 or more cycles on the GBA).
    const j = ((next() >>> 16) * (i + 1)) >>> 16;
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  state = saved;
}

function fade(t: F32): F32 {
  return t * t * t * (t * (t * f32(6) - f32(15)) + f32(10));
}

function gradient(hash: I32, x: F32, y: F32, z: F32): F32 {
  const h = hash & 15;
  const u: F32 = h < 8 ? x : y;
  const v: F32 = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function mix(a: F32, b: F32, t: F32): F32 {
  return a + t * (b - a);
}

// noise() works in fixed point with 15 fraction bits: float math is emulated
// on the GBA at 100 or more cycles an operation, while a lattice cell's
// corners and fractions are small integers. Only the coordinates and the
// result are converted; the result is within 5e-4 of the float version.
const NOISE_ONE: I32 = 32768;
const I32_MAX: I32 = 2147483647;
const I32_MIN: I32 = -2147483648;

/** fade(t) of a 15-bit fraction: t^3 (6t^2 - 15t + 10), a product of at most 2^30, rounded. */
function fadeFixed(t: I32): I32 {
  const t2 = (t * t + 16384) >> 15;
  const t3 = (t2 * t + 16384) >> 15;
  return (t3 * (6 * t2 - 15 * t + 10 * NOISE_ONE) + 16384) >> 15;
}

function gradientFixed(hash: I32, x: I32, y: I32, z: I32): I32 {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * a + t (b - a), rounded, for values within +-2^16 and a weight t of at
 * most 2^15: the difference is split so each product fits in 32 bits.
 */
function mixFixed(a: I32, b: I32, t: I32): I32 {
  const d = b - a;
  return a + (((d >> 2) * t + (((d & 3) * t) >> 2) + 4096) >> 13);
}

export function noise(x: F32, y: F32, z: F32): F32 {
  if (len(perm) === 0) noiseSeed(0);
  const scale: F32 = f32(NOISE_ONE);
  const qx = i32(x * scale),
    qy = i32(y * scale),
    qz = i32(z * scale);
  // i32() saturates coordinates of 65536 or more, which keep to floats.
  if (qx === I32_MAX || qx === I32_MIN || qy === I32_MAX || qy === I32_MIN || qz === I32_MAX || qz === I32_MIN)
    return noiseFloat(x, y, z);
  const xi = (qx >> 15) & 255,
    yi = (qy >> 15) & 255,
    zi = (qz >> 15) & 255;
  const px = qx & (NOISE_ONE - 1),
    py = qy & (NOISE_ONE - 1),
    pz = qz & (NOISE_ONE - 1);
  const u = fadeFixed(px),
    v = fadeFixed(py),
    w = fadeFixed(pz);
  const a = perm[xi] + yi,
    aa = perm[a] + zi,
    ab = perm[a + 1] + zi;
  const b = perm[xi + 1] + yi,
    ba = perm[b] + zi,
    bb = perm[b + 1] + zi;
  const one = NOISE_ONE;
  const value = mixFixed(
    mixFixed(
      mixFixed(gradientFixed(perm[aa], px, py, pz), gradientFixed(perm[ba], px - one, py, pz), u),
      mixFixed(gradientFixed(perm[ab], px, py - one, pz), gradientFixed(perm[bb], px - one, py - one, pz), u),
      v,
    ),
    mixFixed(
      mixFixed(gradientFixed(perm[aa + 1], px, py, pz - one), gradientFixed(perm[ba + 1], px - one, py, pz - one), u),
      mixFixed(
        gradientFixed(perm[ab + 1], px, py - one, pz - one),
        gradientFixed(perm[bb + 1], px - one, py - one, pz - one),
        u,
      ),
      v,
    ),
    w,
  );
  return f32(value) * f32(0.000030517578125); // / 32768
}

/** noise() in floats, for coordinates too large for its fixed point. */
function noiseFloat(x: F32, y: F32, z: F32): F32 {
  const fx = floor(x),
    fy = floor(y),
    fz = floor(z);
  const xi = fx & 255,
    yi = fy & 255,
    zi = fz & 255;
  const px: F32 = x - f32(fx),
    py: F32 = y - f32(fy),
    pz: F32 = z - f32(fz);
  const u = fade(px),
    v = fade(py),
    w = fade(pz);
  const a = perm[xi] + yi,
    aa = perm[a] + zi,
    ab = perm[a + 1] + zi;
  const b = perm[xi + 1] + yi,
    ba = perm[b] + zi,
    bb = perm[b + 1] + zi;
  const one: F32 = f32(1);
  return mix(
    mix(
      mix(gradient(perm[aa], px, py, pz), gradient(perm[ba], px - one, py, pz), u),
      mix(gradient(perm[ab], px, py - one, pz), gradient(perm[bb], px - one, py - one, pz), u),
      v,
    ),
    mix(
      mix(gradient(perm[aa + 1], px, py, pz - one), gradient(perm[ba + 1], px - one, py, pz - one), u),
      mix(gradient(perm[ab + 1], px, py - one, pz - one), gradient(perm[bb + 1], px - one, py - one, pz - one), u),
      v,
    ),
    w,
  );
}
