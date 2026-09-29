/** Entry points the generated root module calls around the game's setup, update and draw. */
import { len, type i32 } from "@pocketjs/framework/solid/std";
import { COLORS } from "./assets";
import { advance, reset as resetAudio } from "./audio";
import { frameCounter, tickFrame } from "./clock";
import { resetSurfaces, resetTilemaps } from "./gfx";
import { DEFAULT_COLORS, setColorList } from "./hw";
import { update as updateInput } from "./input";

let audioTicks: i32 = 0;

/** Loads the baked resources before the game's setup() runs. */
export function boot(): void {
  setColorList(len(COLORS) > 0 ? COLORS : DEFAULT_COLORS);
  resetSurfaces();
  resetTilemaps();
  resetAudio();
}

/** `keys` are the pressed GBA buttons; `ticks` the audio ticks to produce this frame. */
export function beginFrame(keys: i32, ticks: i32): void {
  updateInput(keys, frameCounter());
  audioTicks = ticks;
}

export function endFrame(): void {
  advance(audioTicks);
  tickFrame();
}
