/** GBA buttons, for input.map(): `input.map(input.key.x, input.gba.b)`. Combine them with |. */
import type { i32 as I32 } from "@pocketjs/framework/solid/std";
import { GBA_A, GBA_B, GBA_DOWN, GBA_L, GBA_LEFT, GBA_R, GBA_RIGHT, GBA_SELECT, GBA_START, GBA_UP } from "../input";

export const a: I32 = GBA_A;
export const b: I32 = GBA_B;
export const select: I32 = GBA_SELECT;
export const start: I32 = GBA_START;
export const right: I32 = GBA_RIGHT;
export const left: I32 = GBA_LEFT;
export const up: I32 = GBA_UP;
export const down: I32 = GBA_DOWN;
export const r: I32 = GBA_R;
export const l: I32 = GBA_L;
