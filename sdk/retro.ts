/**
 * The Pyxel API for Pocket Retro games, grouped in namespaces:
 *
 *   import { system, screen, input, sound } from "retro";
 *   system.init(160, 120);
 *   screen.cls(color.navy);
 *   if (input.btn(input.key.left)) sound.play(3, 0);
 *
 * Names inside a namespace follow Pyxel. Methods of Pyxel's image banks and
 * tilemaps take the bank or tilemap first: pyxel.images[1].pset(x, y, c) is
 * image.pset(1, x, y, c). Coordinates and colors are i32; convert float
 * positions with math.round(), which rounds as Pyxel does when it draws.
 * Namespaces name their members only: they cannot be stored or passed.
 */
export * as system from "./api/system";
export * as screen from "./api/screen";
export * as image from "./api/image";
export * as tilemap from "./api/tilemap";
export * as input from "./api/input";
export * as sound from "./api/sound";
export * as music from "./api/music";
export * as math from "./api/math";
export * as text from "./api/text";
export * as color from "./api/color";
