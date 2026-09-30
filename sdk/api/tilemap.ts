/**
 * Tilemaps (pyxel.tilemaps[n]): each method takes the tilemap first, so
 * pyxel.tilemaps[0].pget(x, y) is `tilemap.pget(0, x, y)`. A tile is one i32
 * made by tile(tx, ty), in place of Pyxel's (tx, ty) tuples.
 */
import { codePoints, len, type i32 as I32 } from "@pocketjs/framework/solid/std";
import {
  collide as tilemapCollide,
  setTilemapImage,
  tget,
  tile as tileValue,
  TILEMAP_SIZE,
  tilemapBlt,
  tilemapImage,
  tset,
  walls as tilemapWalls,
  type Delta,
} from "../gfx";
import { hexDigit } from "../hex";

export type { Delta } from "../gfx";

/** Tilemaps (NUM_TILEMAPS). */
export const COUNT: I32 = 8;
/** Width and height of a tilemap in tiles (TILEMAP_SIZE). */
export const SIZE: I32 = TILEMAP_SIZE;
/** Width and height of a tile in pixels (TILE_SIZE). */
export const TILE_SIZE: I32 = 8;

/** A tile value from image tile coordinates, as Pyxel's (tx, ty) tuples. */
export function tile(tx: I32, ty: I32): I32 {
  return tileValue(tx, ty);
}

export function tileX(t: I32): I32 {
  return t & 255;
}

export function tileY(t: I32): I32 {
  return (t >> 8) & 255;
}

/** pyxel.tilemaps[tm].pget(x, y), in tiles. */
export function pget(tm: I32, x: I32, y: I32): I32 {
  return tget(tm, x, y);
}

/** pyxel.tilemaps[tm].pset(x, y, tile), in tiles. */
export function pset(tm: I32, x: I32, y: I32, t: I32): void {
  tset(tm, x, y, t);
}

/**
 * pyxel.tilemaps[tm].set(x, y, rows): each row is a string of tiles, four
 * hex digits each, the image tile's x then y ("0201" is tile(2, 1)). Spaces
 * between tiles are ignored.
 */
export function set(tm: I32, x: I32, y: I32, rows: string[]): void {
  for (let j = 0; j < len(rows); j++) {
    let i = 0,
      value = 0,
      digits = 0;
    for (const code of codePoints(rows[j])) {
      const digit = hexDigit(code);
      if (digit < 0) continue;
      value = (value << 4) | digit;
      digits++;
      if (digits < 4) continue;
      tset(tm, x + i, y + j, tileValue(value >> 8, value & 255));
      i++;
      value = 0;
      digits = 0;
    }
  }
}

/**
 * pyxel.tilemaps[tm].blt(x, y, src, u, v, w, h, tilekey), in tiles: copies
 * the w x h tiles at (u, v) of tilemap src to (x, y) of tilemap tm. Negative
 * w or h flips; source tiles equal to tilekey are left out (-1 for none).
 */
export function blt(tm: I32, x: I32, y: I32, src: I32, u: I32, v: I32, w: I32, h: I32, tilekey: I32 = -1): void {
  tilemapBlt(tm, x, y, src, u, v, w, h, tilekey);
}

/** pyxel.tilemaps[tm].imgsrc. */
export function imgsrc(tm: I32): I32 {
  return tilemapImage(tm);
}

/** pyxel.tilemaps[tm].imgsrc = img. */
export function setImgsrc(tm: I32, img: I32): void {
  setTilemapImage(tm, img);
}

/** Registers wall tiles for collide() and returns the wall set id (at most 8 sets). */
export function walls(tiles: I32[]): I32 {
  return tilemapWalls(tiles);
}

/**
 * pyxel.tilemaps[tm].collide(x, y, w, h, dx, dy, walls) with integer
 * positions: the movement of a w x h box that stops at the wall set's tiles.
 */
export function collide(tm: I32, x: I32, y: I32, w: I32, h: I32, dx: I32, dy: I32, wallSet: I32): Delta {
  return tilemapCollide(tm, x, y, w, h, dx, dy, wallSet);
}
