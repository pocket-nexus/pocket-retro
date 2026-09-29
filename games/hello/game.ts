import { system, screen, input } from "retro";
import { imod, type i32 } from "@pocketjs/framework/solid/std";

let x: i32 = 20;

export function setup(): void {
  system.init(160, 120);
}

export function update(): void {
  if (input.btn(input.key.right)) x++;
  if (input.btn(input.key.left)) x--;
}

export function draw(): void {
  screen.cls(1);
  screen.rect(x, 40, 30, 20, imod(system.frameCount(), 16));
  screen.circ(120, 30, 12, 8);
  screen.line(0, 0, 159, 119, 7);
  screen.tri(10, 110, 40, 80, 70, 110, 11);
  screen.text(5, 5, "HELLO POCKET RETRO", 7);
  for (let i = 0; i < 160; i++) screen.pset(i, 100, 7);
}
