// Pyxel Draw API, ported from pyxel/examples/03_draw_api.py (Takashi Kitao, MIT).
//
// The GBA has no mouse. pyxel.mouse(True) and pyxel.mouse_x/mouse_y become a
// pointer that the D-pad moves (the demo uses no other direction keys); it is
// drawn with Pyxel's own cursor image after draw(), with the clip rectangle
// reset and restored as pyxel-core's draw_cursor does, and its position is
// what the "Current mouse position" line shows. Hold A (SPACE) for the clip
// test. KEY_Q and quit() do nothing on a cartridge.
import {
  blt,
  bltm,
  btn,
  btnp,
  circ,
  circb,
  clamp,
  clip,
  cls,
  floordiv,
  frameCount,
  height,
  imgSet,
  init,
  KEY_DOWN,
  KEY_LEFT,
  KEY_Q,
  KEY_RIGHT,
  KEY_SPACE,
  KEY_UP,
  line,
  pal,
  pset,
  quit,
  rect,
  rectb,
  round,
  setTilemapImgsrc,
  sin,
  text,
  tilemapSet,
  width,
} from "pyxel";
import { f32, type f32 as F32, type i32 } from "@pocketjs/framework/solid/std";

// The mouse pointer: pyxel-core's cursor image (settings.rs CURSOR_DATA),
// kept in image bank 2, which the demo does not use otherwise.
const CURSOR_IMG = 2;
const CURSOR_DATA: string[] = [
  "11111100",
  "17776100",
  "17761000",
  "17676100",
  "16167610",
  "11016761",
  "00001610",
  "00000100",
];
const MOUSE_SPEED = 2;

let mouseX: i32 = 0;
let mouseY: i32 = 0;

let palTestIsEnabled = false;
let clipTestIsEnabled = false;
// The clip rectangle test_clip() set this frame, restored after the cursor.
let clipX: i32 = 0;
let clipY: i32 = 0;
const CLIP_W = 120;
const CLIP_H = 90;

export function setup(): void {
  init(200, 150);
  // pyxel.mouse(True): the pointer starts at the center of the screen.
  imgSet(CURSOR_IMG, 0, 0, CURSOR_DATA);
  mouseX = floordiv(width(), 2);
  mouseY = floordiv(height(), 2);

  // pyxel.images[0].load(0, 0, "assets/cat_16x16.png") and
  // pyxel.images[1].load(0, 0, "assets/tileset_24x32.png") are in pyxel.json.

  tilemapSet(0, 0, 0, [
    "0201 0000 0200 0400 0100 0000 0003 0103 0203 0000 0002",
    "0202 0300 0001 0101 0201 0300 0000 0100 0200 0300 0003",
  ]);
  setTilemapImgsrc(0, 1);

  palTestIsEnabled = false;
  clipTestIsEnabled = false;
}

export function update(): void {
  if (btnp(KEY_Q)) quit();

  palTestIsEnabled = floordiv(frameCount(), 30) % 10 >= 5;
  clipTestIsEnabled = btn(KEY_SPACE);

  updateMouse();
}

/** Moves the pointer that stands in for the mouse with the D-pad. */
function updateMouse(): void {
  if (btn(KEY_LEFT)) mouseX -= MOUSE_SPEED;
  if (btn(KEY_RIGHT)) mouseX += MOUSE_SPEED;
  if (btn(KEY_UP)) mouseY -= MOUSE_SPEED;
  if (btn(KEY_DOWN)) mouseY += MOUSE_SPEED;
  mouseX = clamp(mouseX, 0, width() - 1);
  mouseY = clamp(mouseY, 0, height() - 1);
}

export function draw(): void {
  testPal1();
  testCls(6, 6);
  testClip();
  testPset(6, 20);
  testLine(106, 6);
  testRect(6, 38);
  testRectb(106, 38);
  testCirc(6, 61);
  testCircb(106, 61);
  testBlt(6, 88);
  testBltm(106, 88);
  testText(6, 124);
  testPal2(106, 124);

  drawMouseCursor();
}

/** pyxel-core draws the mouse cursor over the frame with clip and camera reset, then restores them. */
function drawMouseCursor(): void {
  clip();
  blt(mouseX, mouseY, CURSOR_IMG, 0, 0, 8, 8, 0);
  if (clipTestIsEnabled) clip(clipX, clipY, CLIP_W, CLIP_H);
}

function testPal1(): void {
  if (palTestIsEnabled) {
    pal(5, 2);
    pal(12, 7);
    pal(7, 10);
  }
}

function testPal2(x: i32, y: i32): void {
  text(x, y, "pal(col1,col2)", 12);
  pal();
}

function testCls(x: i32, y: i32): void {
  cls(5);
  text(x, y, "cls(col)", 7);
}

function testClip(): void {
  clip();

  if (!clipTestIsEnabled) return;

  const x: F32 = sin(f32(frameCount()) * f32(1.14)) * f32(39) + f32(40);
  const y: F32 = sin(f32(frameCount()) * f32(1.71)) * f32(29) + f32(30);
  const w = CLIP_W;
  const h = CLIP_H;

  text(round(x), round(y - f32(8)), "clip(x,y,w,h)", 14);
  rectb(round(x - f32(1)), round(y - f32(1)), w + 2, h + 2, 14);

  clipX = round(x);
  clipY = round(y);
  clip(clipX, clipY, w, h);
}

function testPset(x0: i32, y0: i32): void {
  // Arguments cannot be reassigned in MicroTS: x and y are local copies.
  let x = x0,
    y = y0;
  text(x, y, "pset(x,y,col)", 7);

  x += 4;
  y += 10;
  for (let i = 0; i < 16; i++) pset(x + i * 2, y, i);
}

function testLine(x0: i32, y0: i32): void {
  let x = x0,
    y = y0;
  text(x, y, "line(x1,y1,x2,y2,col)", 7);

  x += 4;
  y += 9;
  let col = 5;

  for (let i = 0; i < 3; i++) {
    line(x, y + i * 8, x + 48, y + i * 8, col);
    col += 1;
  }

  for (let i = 0; i < 4; i++) {
    line(x + i * 16, y, x + i * 16, y + 16, col);
    col += 1;
  }

  for (let i = 0; i < 4; i++) {
    line(x + i * 16, y, x + (3 - i) * 16, y + 16, col);
    col += 1;
  }
}

function testRect(x0: i32, y0: i32): void {
  let x = x0,
    y = y0;
  text(x, y, "rect(x,y,w,h,col)", 7);

  x += 4;
  y += 16;
  for (let i = 0; i < 8; i++) rect(x + i * 8, y - i, i + 1, i + 1, i + 8);
}

function testRectb(x0: i32, y0: i32): void {
  let x = x0,
    y = y0;
  text(x, y, "rectb(x,y,w,h,col)", 7);

  x += 4;
  y += 16;
  for (let i = 0; i < 8; i++) rectb(x + i * 8, y - i, i + 1, i + 1, i + 8);
}

function testCirc(x0: i32, y0: i32): void {
  let x = x0,
    y = y0;
  text(x, y, "circ(x,y,r,col)", 7);

  x += 4;
  y += 15;
  for (let i = 0; i < 8; i++) circ(x + i * 8, y, i, i + 8);
}

function testCircb(x0: i32, y0: i32): void {
  let x = x0,
    y = y0;
  text(x, y, "circb(x,y,r,col)", 7);

  x += 4;
  y += 15;
  for (let i = 0; i < 8; i++) circb(x + i * 8, y, i, i + 8);
}

function testBlt(x: i32, y0: i32): void {
  let y = y0;
  text(x, y, "blt(x,y,img,u,v,\n    w,h,[colkey])", 7);

  y += 15;
  const offset: F32 = sin(f32(frameCount()) * f32(5.73)) * f32(2);

  blt(x, y, 0, 0, 0, 16, 16);
  blt(round(f32(x) + offset + f32(19)), y, 0, 0, 0, 16, 16, 13);
  blt(x + 38, y, 0, 0, 0, -16, 16, 13);
  blt(x + 57, y, 0, 0, 0, 16, -16, 13);
  blt(x + 76, y, 0, 0, 0, -16, -16, 13);
}

function testBltm(x: i32, y0: i32): void {
  let y = y0;
  text(x, y, "bltm(x,y,tm,u,v,\n     w,h,[colkey])", 7);

  y += 15;
  bltm(x, y, 0, 0, 0, 88, 16, 2);
}

function testText(x0: i32, y0: i32): void {
  let x = x0,
    y = y0;
  text(x, y, "text(x,y,s,col)", 7);

  x += 4;
  y += 8;
  const s = `Elapsed frame count is ${frameCount()}\nCurrent mouse position is (${mouseX},${mouseY})`;
  text(x + 1, y, s, 1);
  text(x, y, s, 9);
}
