// Snake!, ported from pyxel/examples/07_snake.py (Marcus Croucher, MIT).
// On the GBA, START restarts after a game over.
import {
  btn,
  btnp,
  cls,
  FONT_HEIGHT,
  FONT_WIDTH,
  GAMEPAD1_BUTTON_DPAD_DOWN,
  GAMEPAD1_BUTTON_DPAD_LEFT,
  GAMEPAD1_BUTTON_DPAD_RIGHT,
  GAMEPAD1_BUTTON_DPAD_UP,
  GAMEPAD1_BUTTON_START,
  init,
  KEY_DOWN,
  KEY_LEFT,
  KEY_R,
  KEY_RIGHT,
  KEY_UP,
  musicSet,
  play,
  playm,
  pset,
  rect,
  rndi,
  soundSet,
  stop,
  text,
  zfill,
} from "pyxel";
import { idiv, insert, len, pop, push, type i32 } from "@pocketjs/framework/solid/std";

const SCREEN_W = 40;
const SCREEN_H = 50;
const SCORE_H = FONT_HEIGHT;

interface Point {
  x: i32;
  y: i32;
}

let dirX: i32 = 1;
let dirY: i32 = 0;
let snake: Point[] = [];
let popped: Point = { x: 0, y: 0 };
let apple: Point = { x: 0, y: 0 };
let death: boolean = false;
let score: i32 = 0;

export function setup(): void {
  init(SCREEN_W, SCREEN_H, 20);
  initSound();
  reset();
}

function initSound(): void {
  soundSet(0, "c3e3g3c4c4", "s", "4", "nnnnf", 7);
  soundSet(1, "f3 b2 f2 b1  f1 f1 f1 f1", "p", "44444321", "nnnnnnnf", 9);

  const melody1 =
    "c3 c3 c3 d3 e3 r e3 r" +
    "rrrrrrrr" +
    "e3 e3 e3 f3 d3 r c3 r" +
    "rrrrrrrr" +
    "c3 c3 c3 d3 e3 r e3 r" +
    "rrrrrrrr" +
    "b2 b2 b2 f3 d3 r c3 r" +
    "rrrrrrrr";
  const melody2 =
    "rrrr e3e3e3e3 d3d3c3c3 b2b2c3c3" +
    "a2a2a2a2 c3c3c3c3 d3d3d3d3 e3e3e3e3" +
    "rrrr e3e3e3e3 d3d3c3c3 b2b2c3c3" +
    "a2a2a2a2 g2g2g2g2 c3c3c3c3 g2g2a2a2" +
    "rrrr e3e3e3e3 d3d3c3c3 b2b2c3c3" +
    "a2a2a2a2 c3c3c3c3 d3d3d3d3 e3e3e3e3" +
    "f3f3f3a3 a3a3a3a3 g3g3g3b3 b3b3b3b3" +
    "b3b3b3b4 rrrr e3d3c3g3 a2g2e2d2";
  soundSet(2, melody1 + melody1 + melody2 + melody2, "s", "3", "nnnsffff", 20);

  const harmonyPart = "a1 a1 a1 b1  f1 f1 c2 c2  c2 c2 c2 c2  g1 g1 b1 b1";
  const harmony1 = harmonyPart + harmonyPart + harmonyPart + "f1 f1 f1 f1 f1 f1 f1 f1 g1 g1 g1 g1 g1 g1 g1 g1";
  const harmonyBar = repeat("f1", 8) + repeat("g1", 8) + repeat("a1", 8) + repeat("c2", 7) + "d2";
  const harmony2 = harmonyBar + harmonyBar + harmonyBar + repeat("f1", 16) + repeat("g1", 16);
  soundSet(3, harmony1 + harmony1 + harmony2 + harmony2, "t", "5", "f", 20);
  soundSet(4, "f0 r a4 r  f0 f0 a4 r  f0 r a4 r  f0 f0 a4 f0", "n", "6622 6622 6622 6426", "f", 20);

  musicSet(0, [], [2], [3], [4]);
}

function repeat(s: string, count: i32): string {
  let out = "";
  for (let i = 0; i < count; i++) out = out + s;
  return out;
}

function reset(): void {
  dirX = 1;
  dirY = 0;
  snake = [{ x: 5, y: 5 + SCORE_H }];
  death = false;
  score = 0;
  generateApple();
  playm(0, true);
}

export function update(): void {
  if (btnp(KEY_R) || btnp(GAMEPAD1_BUTTON_START)) reset();
  if (!death) {
    updateDirection();
    updateSnake();
    checkDeath();
    checkApple();
  }
}

function updateDirection(): void {
  if (btn(KEY_UP) || btn(GAMEPAD1_BUTTON_DPAD_UP)) {
    if (!(dirX === 0 && dirY === 1)) setDirection(0, -1);
  } else if (btn(KEY_DOWN) || btn(GAMEPAD1_BUTTON_DPAD_DOWN)) {
    if (!(dirX === 0 && dirY === -1)) setDirection(0, 1);
  } else if (btn(KEY_LEFT) || btn(GAMEPAD1_BUTTON_DPAD_LEFT)) {
    if (!(dirX === 1 && dirY === 0)) setDirection(-1, 0);
  } else if ((btn(KEY_RIGHT) || btn(GAMEPAD1_BUTTON_DPAD_RIGHT)) && !(dirX === -1 && dirY === 0)) {
    setDirection(1, 0);
  }
}

function setDirection(x: i32, y: i32): void {
  dirX = x;
  dirY = y;
}

function updateSnake(): void {
  insert(snake, 0, { x: snake[0].x + dirX, y: snake[0].y + dirY });
  popped = pop(snake);
}

function checkApple(): void {
  if (snake[0].x === apple.x && snake[0].y === apple.y) {
    score++;
    push(snake, popped);
    generateApple();
    play(0, 0);
  }
}

function inSnake(x: i32, y: i32): boolean {
  for (let i = 0; i < len(snake); i++) if (snake[i].x === x && snake[i].y === y) return true;
  return false;
}

function generateApple(): void {
  apple = { x: snake[0].x, y: snake[0].y };
  while (inSnake(apple.x, apple.y)) apple = { x: rndi(0, SCREEN_W - 1), y: rndi(SCORE_H + 1, SCREEN_H - 1) };
}

function checkDeath(): void {
  const hx = snake[0].x,
    hy = snake[0].y;
  let repeated = false;
  for (let i = 1; i < len(snake); i++) if (snake[i].x === hx && snake[i].y === hy) repeated = true;
  if (hx < 0 || hy < SCORE_H || hx >= SCREEN_W || hy >= SCREEN_H || repeated) die();
}

function die(): void {
  death = true;
  stop();
  play(0, 1);
}

export function draw(): void {
  if (death) {
    drawDeath();
    return;
  }
  cls(3);

  // Draw snake
  for (let i = 0; i < len(snake); i++) pset(snake[i].x, snake[i].y, i === 0 ? 7 : 11);

  // Draw apple
  pset(apple.x, apple.y, 8);

  // Draw score
  rect(0, 0, SCREEN_W, SCORE_H, 5);
  text(1, 1, zfill(score, 4), 6);
}

function drawDeath(): void {
  cls(8);
  const lines: string[] = ["GAME OVER", zfill(score, 4), "PRESS", "START"];
  for (let i = 0; i < len(lines); i++) {
    const x = idiv(SCREEN_W - len(lines[i]) * FONT_WIDTH, 2);
    text(x, 5 + (FONT_HEIGHT + 2) * i, lines[i], 0);
  }
}
