/**
 * Pyxel's math and random functions, and Python's integer operators:
 * `math.rndi(0, 9)`, `math.floordiv(a, b)`. Angles are in degrees.
 */
import {
  f32,
  i32,
  idiv,
  imod,
  atan2 as stdAtan2,
  sqrt as stdSqrt,
  type f32 as F32,
  type i32 as I32,
} from "@pocketjs/framework/solid/std";
import { round as pyxelRound } from "../gfx";
import { noise as randNoise, noiseSeed, rndf as randRndf, rndi as randRndi, seed } from "../rand";

/** Rounds half away from zero, as Pyxel converts float coordinates. */
export function round(v: F32): I32 {
  return pyxelRound(v);
}

/** Python's int(): truncates toward zero. */
export function int(v: F32): I32 {
  return i32(v);
}

export function ceil(v: F32): I32 {
  const t = i32(v);
  return f32(t) < v ? t + 1 : t;
}

export function floor(v: F32): I32 {
  const t = i32(v);
  return f32(t) > v ? t - 1 : t;
}

/** pyxel.clamp for integers: x limited to lower..upper. */
export function clamp(x: I32, lower: I32, upper: I32): I32 {
  return x < lower ? lower : x > upper ? upper : x;
}

/** pyxel.sgn for integers: -1, 0 or 1. */
export function sgn(x: I32): I32 {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** Python's a // b for integers: floors toward negative infinity. */
export function floordiv(a: I32, b: I32): I32 {
  if (b === 0) return 0;
  const q = idiv(a, b);
  return a % b !== 0 && a < 0 !== b < 0 ? q - 1 : q;
}

/** Python's a % b for integers: the result takes the sign of b. */
export function mod(a: I32, b: I32): I32 {
  if (b === 0) return 0;
  const r = imod(a, b);
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

export function sqrt(v: F32): F32 {
  return stdSqrt(v);
}

/**
 * sin(2 pi (t + quarters / 4)) for an angle of t turns. t is reduced to the
 * nearest quarter turn, and the remainder, at most 45 degrees, goes through
 * the f32 polynomials of FreeBSD's k_sinf and k_cosf: within 2e-7 of the
 * exact value, all in f32. libm's sinf reduces its argument in f64, which
 * the GBA emulates at over 10,000 cycles a call.
 */
function sinTurns(t: F32, quarters: I32): F32 {
  const q = floor(t * f32(4) + f32(0.5));
  const x = (t - f32(q) * f32(0.25)) * f32(6.2831855),
    z = x * x;
  const quadrant = (q + quarters) & 3;
  if (quadrant === 0 || quadrant === 2) {
    const s =
      x + x * z * (f32(-0.16666667) + z * (f32(0.008333329) + z * (f32(-0.00019839335) + z * f32(0.0000027183114))));
    return quadrant === 0 ? s : -s;
  }
  const c = f32(1) + z * (f32(-0.5) + z * (f32(0.041666623) + z * (f32(-0.0013886764) + z * f32(0.000024390449))));
  return quadrant === 1 ? c : -c;
}

/** Sine of an angle in degrees. */
export function sin(deg: F32): F32 {
  return sinTurns(deg * f32(0.0027777778), 0);
}

/** Cosine of an angle in degrees. */
export function cos(deg: F32): F32 {
  return sinTurns(deg * f32(0.0027777778), 1);
}

/** Angle of (x, y) in degrees. */
export function atan2(y: F32, x: F32): F32 {
  return stdAtan2(y, x) * f32(57.29578);
}

export function rseed(value: I32): void {
  seed(value);
}

export function rndi(a: I32, b: I32): I32 {
  return randRndi(a, b);
}

export function rndf(a: F32, b: F32): F32 {
  return randRndf(a, b);
}

export function nseed(value: I32): void {
  noiseSeed(value);
}

/** Perlin noise in about [-1, 1]. */
export function noise(x: F32, y: F32 = 0.0, z: F32 = 0.0): F32 {
  return randNoise(x, y, z);
}
