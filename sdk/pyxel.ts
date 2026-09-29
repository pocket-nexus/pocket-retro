/**
 * The Pyxel API for Pocket Pyxel games: `import { cls, blt, btn } from "pyxel"`.
 *
 * Names follow Pyxel. Coordinates and colors are i32; convert float
 * positions with round(), which rounds as Pyxel does when it draws. Optional
 * Pyxel arguments are defaulted parameters. Methods of Pyxel objects are free
 * functions: pyxel.images[1].pset(x, y, c) is imgPset(1, x, y, c), and
 * pyxel.tilemaps[0].pget(x, y) is tget(0, x, y).
 */
import {
  codePoints,
  f32,
  i32,
  idiv,
  imod,
  len,
  atan2 as stdAtan2,
  cos as stdCos,
  sin as stdSin,
  sqrt as stdSqrt,
  type f32 as F32,
  type i32 as I32,
} from "@pocketjs/framework/solid/std";
import {
  blt as surfaceBlt,
  collide as tilemapCollide,
  walls as tilemapWalls,
  type Delta,
  bltm as surfaceBltm,
  bltTransformed,
  circ as surfaceCirc,
  circb as surfaceCircb,
  cls as surfaceCls,
  elli as surfaceElli,
  ellib as surfaceEllib,
  floodFill,
  line as surfaceLine,
  mapColor,
  pget as surfacePget,
  pset as surfacePset,
  rect as surfaceRect,
  rectb as surfaceRectb,
  resetClip,
  resetColorMap,
  resetSurfaces,
  round as pyxelRound,
  setCamera,
  setClip,
  setDither,
  setTilemapImage,
  text as surfaceText,
  textWidth as surfaceTextWidth,
  tget as tileGet,
  tile as tileValue,
  tilemapImage,
  tri as surfaceTri,
  trib as surfaceTrib,
  tset as tileSet,
} from "./gfx";
import { btn as inputBtn, btnp as inputBtnp, btnr as inputBtnr, mapKey as inputMapKey } from "./input";
import {
  colors,
  height as screenHeight,
  setColor as hwSetColor,
  setColorList,
  setFps,
  setScreen,
  width as screenWidth,
} from "./hw";
import {
  isPlaying,
  play as audioPlay,
  playingNote,
  playingSound,
  playMusic,
  setMusic as audioSetMusic,
  setSound as audioSetSound,
  stop as audioStop,
} from "./audio";
import { noise as randNoise, noiseSeed, rndf as randRndf, rndi as randRndi, seed } from "./rand";
import { frameCounter } from "./clock";

// ---- Constants -----------------------------------------------------------

export const SCREEN: I32 = 3;
export const NUM_COLORS: I32 = 16;
export const NUM_IMAGES: I32 = 3;
export const IMAGE_SIZE: I32 = 256;
export const NUM_TILEMAPS: I32 = 8;
export const TILEMAP_SIZE: I32 = 256;
export const TILE_SIZE: I32 = 8;
export const FONT_WIDTH: I32 = 4;
export const FONT_HEIGHT: I32 = 6;
export const NUM_CHANNELS: I32 = 4;
export const NUM_SOUNDS: I32 = 64;
export const NUM_MUSICS: I32 = 8;

export const COLOR_BLACK: I32 = 0;
export const COLOR_NAVY: I32 = 1;
export const COLOR_PURPLE: I32 = 2;
export const COLOR_GREEN: I32 = 3;
export const COLOR_BROWN: I32 = 4;
export const COLOR_DARK_BLUE: I32 = 5;
export const COLOR_LIGHT_BLUE: I32 = 6;
export const COLOR_WHITE: I32 = 7;
export const COLOR_RED: I32 = 8;
export const COLOR_ORANGE: I32 = 9;
export const COLOR_YELLOW: I32 = 10;
export const COLOR_LIME: I32 = 11;
export const COLOR_CYAN: I32 = 12;
export const COLOR_GRAY: I32 = 13;
export const COLOR_PINK: I32 = 14;
export const COLOR_PEACH: I32 = 15;

export const TONE_TRIANGLE: I32 = 0;
export const TONE_SQUARE: I32 = 1;
export const TONE_PULSE: I32 = 2;
export const TONE_NOISE: I32 = 3;
export const EFFECT_NONE: I32 = 0;
export const EFFECT_SLIDE: I32 = 1;
export const EFFECT_VIBRATO: I32 = 2;
export const EFFECT_FADEOUT: I32 = 3;
export const EFFECT_HALF_FADEOUT: I32 = 4;
export const EFFECT_QUARTER_FADEOUT: I32 = 5;

// GBA buttons, for mapKey().
export const GBA_A: I32 = 1;
export const GBA_B: I32 = 2;
export const GBA_SELECT: I32 = 4;
export const GBA_START: I32 = 8;
export const GBA_RIGHT: I32 = 16;
export const GBA_LEFT: I32 = 32;
export const GBA_UP: I32 = 64;
export const GBA_DOWN: I32 = 128;
export const GBA_R: I32 = 256;
export const GBA_L: I32 = 512;

// Pyxel keys. The numbers are ids for mapKey(), not Pyxel's key codes.
export const KEY_A: I32 = 0;
export const KEY_B: I32 = 1;
export const KEY_C: I32 = 2;
export const KEY_D: I32 = 3;
export const KEY_E: I32 = 4;
export const KEY_F: I32 = 5;
export const KEY_G: I32 = 6;
export const KEY_H: I32 = 7;
export const KEY_I: I32 = 8;
export const KEY_J: I32 = 9;
export const KEY_K: I32 = 10;
export const KEY_L: I32 = 11;
export const KEY_M: I32 = 12;
export const KEY_N: I32 = 13;
export const KEY_O: I32 = 14;
export const KEY_P: I32 = 15;
export const KEY_Q: I32 = 16;
export const KEY_R: I32 = 17;
export const KEY_S: I32 = 18;
export const KEY_T: I32 = 19;
export const KEY_U: I32 = 20;
export const KEY_V: I32 = 21;
export const KEY_W: I32 = 22;
export const KEY_X: I32 = 23;
export const KEY_Y: I32 = 24;
export const KEY_Z: I32 = 25;
export const KEY_0: I32 = 26;
export const KEY_1: I32 = 27;
export const KEY_2: I32 = 28;
export const KEY_3: I32 = 29;
export const KEY_4: I32 = 30;
export const KEY_5: I32 = 31;
export const KEY_6: I32 = 32;
export const KEY_7: I32 = 33;
export const KEY_8: I32 = 34;
export const KEY_9: I32 = 35;
export const KEY_UP: I32 = 36;
export const KEY_DOWN: I32 = 37;
export const KEY_LEFT: I32 = 38;
export const KEY_RIGHT: I32 = 39;
export const KEY_SPACE: I32 = 40;
export const KEY_RETURN: I32 = 41;
export const KEY_ESCAPE: I32 = 42;
export const KEY_BACKSPACE: I32 = 43;
export const KEY_TAB: I32 = 44;
export const KEY_SHIFT: I32 = 45;
export const KEY_LSHIFT: I32 = 46;
export const KEY_RSHIFT: I32 = 47;
export const KEY_CTRL: I32 = 48;
export const KEY_LCTRL: I32 = 49;
export const KEY_RCTRL: I32 = 50;
export const KEY_ALT: I32 = 51;
export const KEY_LALT: I32 = 52;
export const KEY_RALT: I32 = 53;
export const KEY_F1: I32 = 54;
export const KEY_F2: I32 = 55;
export const KEY_F3: I32 = 56;
export const KEY_F4: I32 = 57;
export const KEY_F5: I32 = 58;
export const KEY_F6: I32 = 59;
export const KEY_F7: I32 = 60;
export const KEY_F8: I32 = 61;
export const KEY_F9: I32 = 62;
export const KEY_F10: I32 = 63;
export const KEY_F11: I32 = 64;
export const KEY_F12: I32 = 65;
export const KEY_KP_ENTER: I32 = 66;
export const KEY_MINUS: I32 = 67;
export const KEY_PLUS: I32 = 68;
export const KEY_EQUALS: I32 = 69;
export const KEY_COMMA: I32 = 70;
export const KEY_PERIOD: I32 = 71;
export const KEY_SLASH: I32 = 72;
export const KEY_SEMICOLON: I32 = 73;
export const GAMEPAD1_BUTTON_A: I32 = 80;
export const GAMEPAD1_BUTTON_B: I32 = 81;
export const GAMEPAD1_BUTTON_X: I32 = 82;
export const GAMEPAD1_BUTTON_Y: I32 = 83;
export const GAMEPAD1_BUTTON_BACK: I32 = 84;
export const GAMEPAD1_BUTTON_GUIDE: I32 = 85;
export const GAMEPAD1_BUTTON_START: I32 = 86;
export const GAMEPAD1_BUTTON_LEFTSTICK: I32 = 87;
export const GAMEPAD1_BUTTON_RIGHTSTICK: I32 = 88;
export const GAMEPAD1_BUTTON_LEFTSHOULDER: I32 = 89;
export const GAMEPAD1_BUTTON_RIGHTSHOULDER: I32 = 90;
export const GAMEPAD1_BUTTON_DPAD_UP: I32 = 91;
export const GAMEPAD1_BUTTON_DPAD_DOWN: I32 = 92;
export const GAMEPAD1_BUTTON_DPAD_LEFT: I32 = 93;
export const GAMEPAD1_BUTTON_DPAD_RIGHT: I32 = 94;
export const MOUSE_BUTTON_LEFT: I32 = 100;
export const MOUSE_BUTTON_MIDDLE: I32 = 101;
export const MOUSE_BUTTON_RIGHT: I32 = 102;

/** The default key map: the D-pad, WASD and arrows move; Z, Space and Return act. */
function mapDefaultKeys(): void {
  inputMapKey(KEY_UP, GBA_UP);
  inputMapKey(KEY_W, GBA_UP);
  inputMapKey(GAMEPAD1_BUTTON_DPAD_UP, GBA_UP);
  inputMapKey(KEY_DOWN, GBA_DOWN);
  inputMapKey(KEY_S, GBA_DOWN);
  inputMapKey(GAMEPAD1_BUTTON_DPAD_DOWN, GBA_DOWN);
  inputMapKey(KEY_LEFT, GBA_LEFT);
  inputMapKey(KEY_A, GBA_LEFT);
  inputMapKey(GAMEPAD1_BUTTON_DPAD_LEFT, GBA_LEFT);
  inputMapKey(KEY_RIGHT, GBA_RIGHT);
  inputMapKey(KEY_D, GBA_RIGHT);
  inputMapKey(GAMEPAD1_BUTTON_DPAD_RIGHT, GBA_RIGHT);
  inputMapKey(KEY_Z, GBA_A);
  inputMapKey(KEY_SPACE, GBA_A);
  inputMapKey(KEY_KP_ENTER, GBA_A);
  inputMapKey(GAMEPAD1_BUTTON_A, GBA_A);
  inputMapKey(KEY_X, GBA_B);
  inputMapKey(KEY_BACKSPACE, GBA_B);
  inputMapKey(GAMEPAD1_BUTTON_B, GBA_B);
  inputMapKey(KEY_RETURN, GBA_START | GBA_A);
  inputMapKey(GAMEPAD1_BUTTON_START, GBA_START);
  inputMapKey(KEY_TAB, GBA_SELECT);
  inputMapKey(GAMEPAD1_BUTTON_BACK, GBA_SELECT);
  inputMapKey(GAMEPAD1_BUTTON_X, GBA_L);
  inputMapKey(GAMEPAD1_BUTTON_LEFTSHOULDER, GBA_L);
  inputMapKey(GAMEPAD1_BUTTON_Y, GBA_R);
  inputMapKey(GAMEPAD1_BUTTON_RIGHTSHOULDER, GBA_R);
}

// ---- System --------------------------------------------------------------

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

// ---- Colors --------------------------------------------------------------

/** pyxel.colors[index] = rgb. */
export function setColor(index: I32, rgb: I32): void {
  hwSetColor(index, rgb);
}

/** pyxel.colors[index], or 0 past the last color. */
export function getColor(index: I32): I32 {
  return index >= 0 && index < len(colors) ? colors[index] : 0;
}

/** pyxel.colors.from_list(list). */
export function setColors(list: I32[]): void {
  setColorList(list);
}

export function colorCount(): I32 {
  return len(colors);
}

// ---- Drawing on the screen -----------------------------------------------

export function cls(col: I32): void {
  surfaceCls(SCREEN, col);
}

export function pget(x: I32, y: I32): I32 {
  return surfacePget(SCREEN, x, y);
}

export function pset(x: I32, y: I32, col: I32): void {
  surfacePset(SCREEN, x, y, col);
}

export function line(x1: I32, y1: I32, x2: I32, y2: I32, col: I32): void {
  surfaceLine(SCREEN, x1, y1, x2, y2, col);
}

export function rect(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRect(SCREEN, x, y, w, h, col);
}

export function rectb(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRectb(SCREEN, x, y, w, h, col);
}

export function circ(x: I32, y: I32, r: I32, col: I32): void {
  surfaceCirc(SCREEN, x, y, r, col);
}

export function circb(x: I32, y: I32, r: I32, col: I32): void {
  surfaceCircb(SCREEN, x, y, r, col);
}

export function elli(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceElli(SCREEN, x, y, w, h, col);
}

export function ellib(x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceEllib(SCREEN, x, y, w, h, col);
}

export function tri(x1: I32, y1: I32, x2: I32, y2: I32, x3: I32, y3: I32, col: I32): void {
  surfaceTri(SCREEN, x1, y1, x2, y2, x3, y3, col);
}

export function trib(x1: I32, y1: I32, x2: I32, y2: I32, x3: I32, y3: I32, col: I32): void {
  surfaceTrib(SCREEN, x1, y1, x2, y2, x3, y3, col);
}

/** Flood fill (pyxel.fill). */
export function fill(x: I32, y: I32, col: I32): void {
  floodFill(SCREEN, x, y, col);
}

/**
 * Draws the w x h region at (u, v) of image `img` (0-2, or SCREEN) at (x, y).
 * Negative w or h flips; colkey -1 draws every pixel. rotate is in degrees
 * clockwise and scale is a factor, both about the region's center.
 */
export function blt(
  x: I32,
  y: I32,
  img: I32,
  u: I32,
  v: I32,
  w: I32,
  h: I32,
  colkey: I32 = -1,
  rotate: F32 = 0.0,
  scale: F32 = 1.0,
): void {
  if (rotate !== f32(0) || scale !== f32(1)) bltTransformed(SCREEN, x, y, img, u, v, w, h, colkey, rotate, scale);
  else surfaceBlt(SCREEN, x, y, img, u, v, w, h, colkey);
}

/** Draws the w x h pixel region at (u, v) of tilemap tm at (x, y). */
export function bltm(x: I32, y: I32, tm: I32, u: I32, v: I32, w: I32, h: I32, colkey: I32 = -1): void {
  surfaceBltm(SCREEN, x, y, tm, u, v, w, h, colkey);
}

export function text(x: I32, y: I32, s: string, col: I32): void {
  surfaceText(SCREEN, x, y, s, col);
}

/** Width in pixels of text drawn with the built-in font. */
export function textWidth(s: string): I32 {
  return surfaceTextWidth(s);
}

/** pal(col1, col2) draws col1 as col2; pal() resets the draw palette. */
export function pal(col1: I32 = -1, col2: I32 = -1): void {
  if (col1 < 0) resetColorMap(SCREEN);
  else mapColor(SCREEN, col1, col2);
}

/** Ordered dithering: alpha 1.0 draws every pixel, 0.0 none. */
export function dither(alpha: F32): void {
  setDither(SCREEN, alpha);
}

/** camera(x, y) offsets drawing by (-x, -y); camera() resets it. */
export function camera(x: I32 = 0, y: I32 = 0): void {
  setCamera(SCREEN, x, y);
}

/** clip(x, y, w, h) limits drawing to a rectangle; clip() resets it. */
export function clip(x: I32 = -1, y: I32 = -1, w: I32 = -1, h: I32 = -1): void {
  if (x === -1 && y === -1 && w === -1 && h === -1) resetClip(SCREEN);
  else setClip(SCREEN, x, y, w, h);
}

// ---- Image banks (pyxel.images[n]) ---------------------------------------

export function imgPget(img: I32, x: I32, y: I32): I32 {
  return surfacePget(img, x, y);
}

export function imgPset(img: I32, x: I32, y: I32, col: I32): void {
  surfacePset(img, x, y, col);
}

export function imgCls(img: I32, col: I32): void {
  surfaceCls(img, col);
}

export function imgLine(img: I32, x1: I32, y1: I32, x2: I32, y2: I32, col: I32): void {
  surfaceLine(img, x1, y1, x2, y2, col);
}

export function imgRect(img: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRect(img, x, y, w, h, col);
}

export function imgRectb(img: I32, x: I32, y: I32, w: I32, h: I32, col: I32): void {
  surfaceRectb(img, x, y, w, h, col);
}

export function imgCirc(img: I32, x: I32, y: I32, r: I32, col: I32): void {
  surfaceCirc(img, x, y, r, col);
}

export function imgCircb(img: I32, x: I32, y: I32, r: I32, col: I32): void {
  surfaceCircb(img, x, y, r, col);
}

export function imgTri(img: I32, x1: I32, y1: I32, x2: I32, y2: I32, x3: I32, y3: I32, col: I32): void {
  surfaceTri(img, x1, y1, x2, y2, x3, y3, col);
}

export function imgFill(img: I32, x: I32, y: I32, col: I32): void {
  floodFill(img, x, y, col);
}

export function imgBlt(img: I32, x: I32, y: I32, src: I32, u: I32, v: I32, w: I32, h: I32, colkey: I32 = -1): void {
  surfaceBlt(img, x, y, src, u, v, w, h, colkey);
}

export function imgBltm(img: I32, x: I32, y: I32, tm: I32, u: I32, v: I32, w: I32, h: I32, colkey: I32 = -1): void {
  surfaceBltm(img, x, y, tm, u, v, w, h, colkey);
}

export function imgText(img: I32, x: I32, y: I32, s: string, col: I32): void {
  surfaceText(img, x, y, s, col);
}

/**
 * pyxel.images[img].set(x, y, rows): each row is a string of hex digits,
 * one palette index per pixel.
 */
export function imgSet(img: I32, x: I32, y: I32, rows: string[]): void {
  for (let j = 0; j < len(rows); j++) {
    let i = 0;
    for (const code of codePoints(rows[j])) {
      const digit =
        code >= 48 && code <= 57
          ? code - 48
          : code >= 97 && code <= 102
            ? code - 87
            : code >= 65 && code <= 70
              ? code - 55
              : -1;
      if (digit < 0) continue;
      surfacePset(img, x + i, y + j, digit);
      i++;
    }
  }
}

// ---- Tilemaps (pyxel.tilemaps[n]) ----------------------------------------

/** A tile value from image tile coordinates, as Pyxel's (tx, ty) tuples. */
export function tile(tx: I32, ty: I32): I32 {
  return tileValue(tx, ty);
}

export function tileX(t: I32): I32 {
  return t & 255;
}

export function tileY(t: I32): I32 {
  return (t >> 8) & 255;
}

/** pyxel.tilemaps[tm].pget(x, y), in tiles. */
export function tget(tm: I32, x: I32, y: I32): I32 {
  return tileGet(tm, x, y);
}

/** pyxel.tilemaps[tm].pset(x, y, tile), in tiles. */
export function tset(tm: I32, x: I32, y: I32, t: I32): void {
  tileSet(tm, x, y, t);
}

/** Registers wall tiles for collide() and returns the wall set id (at most 8 sets). */
export function walls(tiles: I32[]): I32 {
  return tilemapWalls(tiles);
}

/**
 * pyxel.tilemaps[tm].collide(x, y, w, h, dx, dy, walls) with integer
 * positions: the movement of a w x h box that stops at the wall set's tiles.
 */
export function collide(tm: I32, x: I32, y: I32, w: I32, h: I32, dx: I32, dy: I32, wallSet: I32): Delta {
  return tilemapCollide(tm, x, y, w, h, dx, dy, wallSet);
}

/** pyxel.tilemaps[tm].imgsrc. */
export function tilemapImgsrc(tm: I32): I32 {
  return tilemapImage(tm);
}

export function setTilemapImgsrc(tm: I32, img: I32): void {
  setTilemapImage(tm, img);
}

// ---- Input ---------------------------------------------------------------

export function btn(key: I32): boolean {
  return inputBtn(key);
}

export function btnp(key: I32, hold: I32 = 0, repeat: I32 = 0): boolean {
  return inputBtnp(key, hold, repeat);
}

export function btnr(key: I32): boolean {
  return inputBtnr(key);
}

/** Makes `key` read the given GBA buttons (GBA_* flags ORed together; 0 unmaps). */
export function mapKey(key: I32, gbaButtons: I32): void {
  inputMapKey(key, gbaButtons);
}

// ---- Audio ---------------------------------------------------------------

/** Plays sound `snd` on channel `ch`. */
export function play(ch: I32, snd: I32, loop: boolean = false, resume: boolean = false): void {
  audioPlay(ch, [snd], loop, resume);
}

/** Plays a list of sounds in order on channel `ch`. */
export function playList(ch: I32, snds: I32[], loop: boolean = false, resume: boolean = false): void {
  audioPlay(ch, snds, loop, resume);
}

export function playm(msc: I32, loop: boolean = false): void {
  playMusic(msc, loop);
}

/** stop(ch) stops one channel; stop() stops all. */
export function stop(ch: I32 = -1): void {
  if (ch >= 0) {
    audioStop(ch);
    return;
  }
  for (let c = 0; c < NUM_CHANNELS; c++) audioStop(c);
}

/** The sound playing on a channel, or -1 (the first half of pyxel.play_pos). */
export function playPosSound(ch: I32): I32 {
  return playingSound(ch);
}

/** The note index playing on a channel, or -1. */
export function playPosNote(ch: I32): I32 {
  return playingNote(ch);
}

export function channelPlaying(ch: I32): boolean {
  return isPlaying(ch);
}

/** pyxel.sounds[snd].set(notes, tones, volumes, effects, speed). */
export function soundSet(snd: I32, notes: string, tones: string, volumes: string, effects: string, speed: I32): void {
  audioSetSound(snd, notes, tones, volumes, effects, speed);
}

/** pyxel.musics[msc].set(seq0, seq1, seq2, seq3). */
export function musicSet(msc: I32, seq0: I32[], seq1: I32[], seq2: I32[], seq3: I32[]): void {
  audioSetMusic(msc, seq0, seq1, seq2, seq3);
}

// ---- Math ----------------------------------------------------------------

/** Rounds half away from zero, as Pyxel converts float coordinates. */
export function round(v: F32): I32 {
  return pyxelRound(v);
}

/** Python's int(): truncates toward zero. */
export function int(v: F32): I32 {
  return i32(v);
}

export function ceil(v: F32): I32 {
  const t = i32(v);
  return f32(t) < v ? t + 1 : t;
}

export function floor(v: F32): I32 {
  const t = i32(v);
  return f32(t) > v ? t - 1 : t;
}

/** Python's a // b for integers: floors toward negative infinity. */
export function floordiv(a: I32, b: I32): I32 {
  if (b === 0) return 0;
  const q = idiv(a, b);
  return a % b !== 0 && a < 0 !== b < 0 ? q - 1 : q;
}

/** Python's a % b for integers: the result takes the sign of b. */
export function mod(a: I32, b: I32): I32 {
  if (b === 0) return 0;
  const r = imod(a, b);
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

export function sqrt(v: F32): F32 {
  return stdSqrt(v);
}

/** Sine of an angle in degrees. */
export function sin(deg: F32): F32 {
  return stdSin(deg * f32(0.017453292));
}

/** Cosine of an angle in degrees. */
export function cos(deg: F32): F32 {
  return stdCos(deg * f32(0.017453292));
}

/** Angle of (x, y) in degrees. */
export function atan2(y: F32, x: F32): F32 {
  return stdAtan2(y, x) * f32(57.29578);
}

export function rseed(value: I32): void {
  seed(value);
}

export function rndi(a: I32, b: I32): I32 {
  return randRndi(a, b);
}

export function rndf(a: F32, b: F32): F32 {
  return randRndf(a, b);
}

export function nseed(value: I32): void {
  noiseSeed(value);
}

/** Perlin noise in about [-1, 1]. */
export function noise(x: F32, y: F32 = 0.0, z: F32 = 0.0): F32 {
  return randNoise(x, y, z);
}

// ---- Python helpers ------------------------------------------------------

/** Python's str() of an integer. */
export function str(n: I32): string {
  return `${n}`;
}

/** Python's s.rjust(width, fill): pads on the left to `width` characters. */
export function rjust(s: string, width: I32, fill: string = " "): string {
  let out = s;
  for (let i = len(s); i < width; i++) out = fill + out;
  return out;
}

/** Python's s.ljust(width, fill): pads on the right to `width` characters. */
export function ljust(s: string, width: I32, fill: string = " "): string {
  let out = s;
  for (let i = len(s); i < width; i++) out = out + fill;
  return out;
}

/** Python's str(n).zfill(width) for an integer. */
export function zfill(n: I32, width: I32): string {
  const digits = rjust(`${n < 0 ? -n : n}`, n < 0 ? width - 1 : width, "0");
  return n < 0 ? "-" + digits : digits;
}
