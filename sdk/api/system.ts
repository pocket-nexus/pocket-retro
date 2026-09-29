/** The system (pyxel.init, width, height, frame_count, quit): `system.init(160, 120)`. */
import type { i32 as I32 } from "@pocketjs/framework/solid/std";
import { frameCounter } from "../clock";
import { resetSurfaces } from "../gfx";
import { height as screenHeight, setFps, setScreen, width as screenWidth } from "../hw";
import { mapDefaultKeys } from "../input";

/** Opens a w x h screen (at most 240 x 160 on the GBA) running at `fps` frames per second. */
export function init(w: I32, h: I32, fps: I32 = 30): void {
  setScreen(w, h);
  setFps(fps);
  resetSurfaces();
  mapDefaultKeys();
}

export function width(): I32 {
  return screenWidth;
}

export function height(): I32 {
  return screenHeight;
}

/** Frames since boot, counted after each draw(). */
export function frameCount(): I32 {
  return frameCounter();
}

/** Has no effect: a cartridge keeps running. */
export function quit(): void {}
