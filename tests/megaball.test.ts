/**
 * Checks the facts about Megaball's resources that its drawing relies on
 * (ASSET FACTS in games/megaball/game.ts) rather than measuring them at boot.
 *
 *   bun test tests/megaball.test.ts
 */
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadGameResource } from "../tools/lib/assets.ts";
import { readManifest } from "../tools/lib/manifest.ts";
import { IMAGE_SIZE, TILEMAP_SIZE } from "../tools/lib/pyxres.ts";

const GAME = resolve(import.meta.dir, "../games/megaball");
const resource = loadGameResource(readManifest(GAME), GAME);
const image = resource.images[0];
/** The DEFAULT palette: NAVY, GREEN, LIME and WHITE. */
const COLORS = [1, 3, 11, 7];
const KEY = 8;

// The regions of image 0 the game draws, [u, v, w, h, keyed]: the HUD,
// digits, lights, spinners, ball, 21 x 21 animations, menu and pause words,
// logo, panels, game over and game complete.
const DRAWN_REGIONS = [
  [0, 0, 160, 16, 0], [0, 16, 160, 8, 0], [0, 24, 8, 120, 0], [8, 24, 8, 120, 0],
  [16, 56, 80, 8, 1], [160, 0, 40, 8, 0], [160, 8, 36, 9, 1], [16, 33, 9, 9, 1],
  [0, 231, 252, 21, 1], [16, 72, 160, 8, 1], [16, 80, 144, 8, 1], [96, 64, 32, 8, 1],
  [16, 88, 135, 44, 1], [0, 144, 116, 52, 1], [0, 196, 100, 26, 1], [136, 136, 112, 88, 0],
]; // prettier-ignore
// BANDED in game.ts: [u, v, w, h, first, end], rows first to end - 1 free of the key.
const BANDED = [
  [16, 88, 135, 44, 8, 29],
  [0, 144, 116, 52, 4, 47],
  [0, 196, 100, 26, 4, 21],
];

// FRAME_TRIM in game.ts: [x, y, w, h] of each 21 x 21 animation frame's pixels other than the key.
const FRAME_TRIM = [
  [6, 6, 9, 9], [6, 6, 8, 8], [7, 7, 6, 6], [8, 8, 4, 4], [9, 9, 3, 3], [9, 9, 3, 3],
  [7, 7, 8, 8], [5, 5, 12, 12], [3, 3, 16, 16], [2, 2, 18, 18], [1, 1, 20, 20], [0, 0, 0, 0],
]; // prettier-ignore

function pixel(x: number, y: number): number {
  return image[y * IMAGE_SIZE + x];
}

test("stage tiles hold only the DEFAULT colors", () => {
  // Stages 0 to 15 are 16-row windows of tilemap 0; the ending is tilemap 1's first.
  const windows = [...Array.from({ length: 16 }, (_, num) => [0, num * 16]), [1, 0]];
  const bad = new Set<number>();
  for (const [tm, row] of windows)
    for (let yc = 0; yc < 15; yc++)
      for (let xc = 0; xc < 18; xc++) {
        const at = ((row + yc) * TILEMAP_SIZE + xc) * 2;
        const tx = resource.tilemaps[tm][at],
          ty = resource.tilemaps[tm][at + 1];
        for (let j = 0; j < 8; j++)
          for (let i = 0; i < 8; i++) {
            const c = pixel(tx * 8 + i, ty * 8 + j);
            if (!COLORS.includes(c)) bad.add(c);
          }
      }
  expect([...bad]).toEqual([]);
});

test("drawn regions hold only the DEFAULT colors and the key", () => {
  for (const [u, v, w, h, keyed] of DRAWN_REGIONS) {
    const bad = new Set<number>();
    for (let y = v; y < v + h; y++)
      for (let x = u; x < u + w; x++) {
        const c = pixel(x, y);
        if (!COLORS.includes(c) && !(keyed && c === KEY)) bad.add(c);
      }
    expect(`${u},${v} ${[...bad]}`).toBe(`${u},${v} `);
  }
});

test("banded blits hold the key only outside their middle rows", () => {
  for (const [u, v, w, h, first, end] of BANDED) {
    const keyed: number[] = [];
    for (let j = 0; j < h; j++) {
      let found = false;
      for (let i = 0; i < w; i++) if (pixel(u + i, v + j) === KEY) found = true;
      if (found) keyed.push(j);
    }
    expect(keyed.filter((j) => j >= first && j < end)).toEqual([]);
  }
});

test("animation frames hold only the key outside their trimmed boxes", () => {
  FRAME_TRIM.forEach(([tx, ty, tw, th], frame) => {
    const outside: string[] = [];
    for (let y = 0; y < 21; y++)
      for (let x = 0; x < 21; x++) {
        const inside = x >= tx && x < tx + tw && y >= ty && y < ty + th;
        if (!inside && pixel(frame * 21 + x, 231 + y) !== KEY) outside.push(`${x},${y}`);
      }
    expect(`frame ${frame}: ${outside}`).toBe(`frame ${frame}: `);
  });
});
