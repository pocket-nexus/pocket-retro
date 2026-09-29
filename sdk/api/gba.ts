/** GBA buttons, for input.map(): `input.map(input.key.X, input.gba.B)`. Combine them with |. */
import type { i32 as I32 } from "@pocketjs/framework/solid/std";
import { GBA_A, GBA_B, GBA_DOWN, GBA_L, GBA_LEFT, GBA_R, GBA_RIGHT, GBA_SELECT, GBA_START, GBA_UP } from "../input";

export const A: I32 = GBA_A;
export const B: I32 = GBA_B;
export const SELECT: I32 = GBA_SELECT;
export const START: I32 = GBA_START;
export const RIGHT: I32 = GBA_RIGHT;
export const LEFT: I32 = GBA_LEFT;
export const UP: I32 = GBA_UP;
export const DOWN: I32 = GBA_DOWN;
export const R: I32 = GBA_R;
export const L: I32 = GBA_L;
