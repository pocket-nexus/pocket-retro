/** The frame counter behind pyxel.frame_count. */
import type { i32 } from "@pocketjs/framework/solid/std";

let frames: i32 = 0;

export function frameCounter(): i32 {
  return frames;
}

export function tickFrame(): void {
  frames++;
}
