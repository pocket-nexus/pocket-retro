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
    const j = i32(u32(next()) % u32(i + 1));
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

export function noise(x: F32, y: F32, z: F32): F32 {
  if (len(perm) === 0) noiseSeed(0);
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
