// Pyxel Jump, ported from pyxel/examples/02_jump_game.py (Takashi Kitao, MIT).
import {
  blt,
  btn,
  cls,
  floordiv,
  frameCount,
  GAMEPAD1_BUTTON_DPAD_LEFT,
  GAMEPAD1_BUTTON_DPAD_RIGHT,
  height,
  init,
  KEY_LEFT,
  KEY_RIGHT,
  mod,
  play,
  playm,
  rjust,
  rndi,
  str,
  text,
  width,
} from "retro";
import { abs, len, push, type i32 } from "@pocketjs/framework/solid/std";

interface Floor {
  x: i32;
  y: i32;
  isAlive: boolean;
}

interface Fruit {
  x: i32;
  y: i32;
  kind: i32;
  isAlive: boolean;
}

const FAR_CLOUD_X: i32[] = [-10, 40, 90];
const FAR_CLOUD_Y: i32[] = [75, 65, 60];
const NEAR_CLOUD_X: i32[] = [10, 70, 120];
const NEAR_CLOUD_Y: i32[] = [25, 35, 15];

let score: i32 = 0;
let playerX: i32 = 72;
let playerY: i32 = -16;
let playerDy: i32 = 0;
let isAlive: boolean = true;
let floors: Floor[] = [];
let fruits: Fruit[] = [];

export function setup(): void {
  init(160, 120);
  for (let i = 0; i < 4; i++) push(floors, { x: i * 60, y: rndi(8, 104), isAlive: true });
  for (let i = 0; i < 4; i++) push(fruits, { x: i * 60, y: rndi(0, 104), kind: rndi(0, 2), isAlive: true });
  playm(0, true);
}

export function update(): void {
  updatePlayer();
  for (let i = 0; i < len(floors); i++) updateFloor(i);
  for (let i = 0; i < len(fruits); i++) updateFruit(i);
}

function updatePlayer(): void {
  if (btn(KEY_LEFT) || btn(GAMEPAD1_BUTTON_DPAD_LEFT)) playerX = playerX - 2 > 0 ? playerX - 2 : 0;
  if (btn(KEY_RIGHT) || btn(GAMEPAD1_BUTTON_DPAD_RIGHT))
    playerX = playerX + 2 < width() - 16 ? playerX + 2 : width() - 16;
  playerY += playerDy;
  playerDy = playerDy + 1 < 8 ? playerDy + 1 : 8;
  if (playerY > height()) {
    if (isAlive) {
      isAlive = false;
      play(3, 5);
    }
    if (playerY > 600) {
      score = 0;
      playerX = 72;
      playerY = -16;
      playerDy = 0;
      isAlive = true;
    }
  }
}

function updateFloor(i: i32): void {
  if (floors[i].isAlive) {
    const x = floors[i].x,
      y = floors[i].y;
    if (playerX + 16 >= x && playerX <= x + 40 && playerY + 16 >= y && playerY <= y + 8 && playerDy > 0) {
      floors[i].isAlive = false;
      score += 10;
      playerDy = -12;
      play(3, 3);
    }
  } else {
    floors[i].y += 6;
  }
  floors[i].x -= 4;
  if (floors[i].x < -40) {
    floors[i].x += 240;
    floors[i].y = rndi(8, 104);
    floors[i].isAlive = true;
  }
}

function updateFruit(i: i32): void {
  if (fruits[i].isAlive && abs(fruits[i].x - playerX) < 12 && abs(fruits[i].y - playerY) < 12) {
    fruits[i].isAlive = false;
    score += (fruits[i].kind + 1) * 100;
    playerDy = playerDy < -8 ? playerDy : -8;
    play(3, 4);
  }
  fruits[i].x -= 2;
  if (fruits[i].x < -40) {
    fruits[i].x += 240;
    fruits[i].y = rndi(0, 104);
    fruits[i].kind = rndi(0, 2);
    fruits[i].isAlive = true;
  }
}

export function draw(): void {
  cls(12);

  // Draw sky
  blt(0, 88, 0, 0, 88, 160, 32);

  // Draw mountain
  blt(0, 88, 0, 0, 64, 160, 24, 12);

  // Draw trees
  let offset = mod(frameCount(), 160);
  for (let i = 0; i < 2; i++) blt(i * 160 - offset, 104, 0, 0, 48, 160, 16, 12);

  // Draw clouds
  offset = mod(floordiv(frameCount(), 16), 160);
  for (let i = 0; i < 2; i++)
    for (let c = 0; c < 3; c++) blt(FAR_CLOUD_X[c] + i * 160 - offset, FAR_CLOUD_Y[c], 0, 64, 32, 32, 8, 12);
  offset = mod(floordiv(frameCount(), 8), 160);
  for (let i = 0; i < 2; i++)
    for (let c = 0; c < 3; c++) blt(NEAR_CLOUD_X[c] + i * 160 - offset, NEAR_CLOUD_Y[c], 0, 0, 32, 56, 8, 12);

  // Draw floors
  for (const floor of floors) blt(floor.x, floor.y, 0, 0, 16, 40, 8, 12);

  // Draw fruits
  for (const fruit of fruits) if (fruit.isAlive) blt(fruit.x, fruit.y, 0, 32 + fruit.kind * 16, 0, 16, 16, 12);

  // Draw player
  blt(playerX, playerY, 0, playerDy > 0 ? 16 : 0, 0, 16, 16, 12);

  // Draw score
  const s = `SCORE ${rjust(str(score), 4)}`;
  text(5, 4, s, 1);
  text(4, 4, s, 7);
}
