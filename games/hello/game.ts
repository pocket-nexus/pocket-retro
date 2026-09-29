import { init, cls, rect, pset, btn, frameCount, text, circ, line, tri, KEY_LEFT, KEY_RIGHT, rndi } from "pyxel";
import { imod, type i32 } from "@pocketjs/framework/solid/std";

let x: i32 = 20;

export function setup(): void {
  init(160, 120);
}

export function update(): void {
  if (btn(KEY_RIGHT)) x++;
  if (btn(KEY_LEFT)) x--;
}

export function draw(): void {
  cls(1);
  rect(x, 40, 30, 20, imod(frameCount(), 16));
  circ(120, 30, 12, 8);
  line(0, 0, 159, 119, 7);
  tri(10, 110, 40, 80, 70, 110, 11);
  text(5, 5, "HELLO POCKET PYXEL", 7);
  for (let i = 0; i < 160; i++) pset(i, 100, 7);
}
