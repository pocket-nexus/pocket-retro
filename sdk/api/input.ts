/**
 * Buttons (pyxel.btn, btnp, btnr): `input.btn(input.key.left)`. Keys, gamepad
 * and mouse buttons map to GBA buttons; input.map() changes a mapping.
 */
import type { i32 as I32 } from "@pocketjs/framework/solid/std";
import { btn as inputBtn, btnp as inputBtnp, btnr as inputBtnr, mapKey } from "../input";

export * as key from "./key";
export * as pad from "./pad";
export * as mouse from "./mouse";
export * as gba from "./gba";

export function btn(key: I32): boolean {
  return inputBtn(key);
}

export function btnp(key: I32, hold: I32 = 0, repeat: I32 = 0): boolean {
  return inputBtnp(key, hold, repeat);
}

export function btnr(key: I32): boolean {
  return inputBtnr(key);
}

/** Makes `key` read the given GBA buttons (input.gba flags ORed together; 0 unmaps). */
export function map(key: I32, gbaButtons: I32): void {
  mapKey(key, gbaButtons);
}
