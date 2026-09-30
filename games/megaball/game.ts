// Megaball, ported from pyxel/examples/apps/megaball.pyxapp (megaball/main.py,
// constants.py, globals.py, game.py, audio.py, input.py, circle.py, rect.py,
// utils.py, palette.py, screenshake.py, hud.py, mainmenu.py, stage.py,
// stagedata.py, player.py, spinner.py, light.py and weapon.py) by Adam,
// https://github.com/helpcomputer/megaball, MIT license. Made for GBJam 8:
// design and art by helpcomputer0, sound and music by Mike Richmond.
//
// The modules follow one another below in that order of dependence. Classes
// become module-level state and functions; there is one Game, Stage, Player
// and main menu at a time. On the GBA, A fires and confirms, START or B
// pauses, L toggles sound (F1) and R toggles music (F2).
import { system, screen, image, tilemap, input, sound, music, math, color } from "retro";
import { abs, clear, f32, fill, idiv, len, push, removeAt, type i32 } from "@pocketjs/framework/solid/std";

// Positions and speeds of the ball, the spinners and the weapon's shots are
// 16.16 fixed point: the GBA has no FPU, and the float physics of the
// original would cost thousands of cycles per object per frame.
const ONE = 65536;
const HALF = 32768;

/** A 16.16 value rounded to a pixel, halves away from zero, as Pyxel rounds float coordinates. */
function toPx(v: i32): i32 {
  return v >= 0 ? (v + HALF) >> 16 : -((-v + HALF) >> 16);
}

// ---- constants.py ------------------------------------------------------------

// GAME_TITLE is the cartridge title in retro.json; GAME_SCALE sizes the PC
// window. IMAGE_BANK_0_FILE and RESOURCE_FILE are baked from retro.json.
const GAME_WIDTH = 160;
const GAME_HEIGHT = 144;
const GAME_FPS = 60;

// The collision matrices of the triangle slope tiles, 8 x 8 each, one after
// the other in COLLIDE_MATRIX_ALL: a matrix is named by its index.
const COLLIDE_TOP_LEFT = 0;
const COLLIDE_TOP_RIGHT = 1;
const COLLIDE_BOTTOM_RIGHT = 2;
const COLLIDE_BOTTOM_LEFT = 3;
const COLLIDE_NONE = -1;

const COLLIDE_MATRIX_ALL: i32[] = [
  // COLLIDE_TOP_LEFT
  1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 0, 0,
  1, 1, 1, 1, 1, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0,
  1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 0, 0, 0, 0, 0, 0,
  1, 0, 0, 0, 0, 0, 0, 0,
  // COLLIDE_TOP_RIGHT
  1, 1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 1,
  // COLLIDE_BOTTOM_RIGHT
  0, 0, 0, 0, 0, 0, 0, 1,
  0, 0, 0, 0, 0, 0, 1, 1,
  0, 0, 0, 0, 0, 1, 1, 1,
  0, 0, 0, 0, 1, 1, 1, 1,
  0, 0, 0, 1, 1, 1, 1, 1,
  0, 0, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1,
  // COLLIDE_BOTTOM_LEFT
  1, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1,
]; // prettier-ignore

function isCollidingMatrix(x: i32, y: i32, matrix: i32): boolean {
  if (matrix < COLLIDE_TOP_LEFT || matrix > COLLIDE_BOTTOM_LEFT) return false;

  if (x < 0 || x > 7 || y < 0 || y > 7) return false;

  return COLLIDE_MATRIX_ALL[matrix * 64 + y * 8 + x] === 1;
}

// ---- globals.py --------------------------------------------------------------

const STARTING_LIVES = 2;
const MAX_SCORE = 999999;
const MAX_LIVES = 99;

const SCORE_HIT_LIGHT = 200;
const SCORE_STAGE_COMPLETE = 1000;
const SCORE_USE_WEAPON = 4000;
const SCORE_KILLED_SPINNER = 200;
const SCORE_KILLED_ALL_SPINNERS = 10000;

let gLives = STARTING_LIVES;
let gScore = 0;
let gHighscore = 0;
let gStageNum = 1;
let gSoundOn = true;
let gMusicOn = true;

function globalsReset(): void {
  gLives = STARTING_LIVES;
  gScore = 0;
  gStageNum = 1;
}

function toggleSound(): void {
  gSoundOn = !gSoundOn;

  if (!gSoundOn) sound.stop();
}

function toggleMusic(): void {
  gMusicOn = !gMusicOn;

  if (!gMusicOn) sound.stop();
  else gameRestartMusic();
}

function setHighScore(): void {
  gHighscore = gScore > gHighscore ? gScore : gHighscore;
}

function addLives(amt: i32): void {
  gLives = math.clamp(gLives + amt, 0, MAX_LIVES);
}

function addScore(amt: i32): void {
  gScore = math.clamp(gScore + amt, 0, MAX_SCORE);
}

// ---- input.py ----------------------------------------------------------------

const UP = 0;
const DOWN = 1;
const LEFT = 2;
const RIGHT = 3;
const BUTTON_A = 4;
const BUTTON_B = 5;
const BUTTON_START = 6;

// Input.pressing and Input.pressed, as sets of the buttons above (bit 1 << b).
// K and L have no GBA button and read as never pressed.
let pressing = 0;
let pressed = 0;

function inputGet(): void {
  pressing = 0;
  pressed = 0;

  // pressing
  if (input.btn(input.key.UP) || input.btn(input.key.W) || input.btn(input.pad.DPAD_UP)) pressing |= 1 << UP;
  else if (input.btn(input.key.DOWN) || input.btn(input.key.S) || input.btn(input.pad.DPAD_DOWN)) pressing |= 1 << DOWN;

  if (input.btn(input.key.LEFT) || input.btn(input.key.A) || input.btn(input.pad.DPAD_LEFT)) pressing |= 1 << LEFT;
  else if (input.btn(input.key.RIGHT) || input.btn(input.key.D) || input.btn(input.pad.DPAD_RIGHT))
    pressing |= 1 << RIGHT;

  if (input.btn(input.key.Z) || input.btn(input.key.K) || input.btn(input.key.SPACE) || input.btn(input.pad.A))
    pressing |= 1 << BUTTON_A;

  if (input.btn(input.key.X) || input.btn(input.key.L) || input.btn(input.pad.B)) pressing |= 1 << BUTTON_B;

  if (input.btn(input.key.RETURN) || input.btn(input.pad.START)) pressing |= 1 << BUTTON_START;

  // pressed
  if (input.btnp(input.key.UP) || input.btnp(input.key.W) || input.btnp(input.pad.DPAD_UP)) pressed |= 1 << UP;
  else if (input.btnp(input.key.DOWN) || input.btnp(input.key.S) || input.btnp(input.pad.DPAD_DOWN))
    pressed |= 1 << DOWN;

  if (input.btnp(input.key.LEFT) || input.btnp(input.key.A) || input.btnp(input.pad.DPAD_LEFT)) pressed |= 1 << LEFT;
  else if (input.btnp(input.key.RIGHT) || input.btnp(input.key.D) || input.btnp(input.pad.DPAD_RIGHT))
    pressed |= 1 << RIGHT;

  if (input.btnp(input.key.Z) || input.btnp(input.key.K) || input.btnp(input.key.SPACE) || input.btnp(input.pad.A))
    pressed |= 1 << BUTTON_A;

  if (input.btnp(input.key.X) || input.btnp(input.key.L) || input.btnp(input.pad.B)) pressed |= 1 << BUTTON_B;

  if (input.btnp(input.key.RETURN) || input.btnp(input.pad.START)) pressed |= 1 << BUTTON_START;
}

function isPressing(button: i32): boolean {
  return (pressing & (1 << button)) !== 0;
}

function isPressed(button: i32): boolean {
  return (pressed & (1 << button)) !== 0;
}

// ---- audio.py ----------------------------------------------------------------

const MUS_IN_GAME = 0;
const MUS_TITLE = 1;
const MUS_START = 2;
const MUS_STAGE_COMPLETE = 3;
const MUS_DEATH = 4;
const MUS_GAME_OVER = 5;

// MUS_GAME_OVER is left out of MUSIC, so it never plays.
const MUSIC: i32[] = [MUS_IN_GAME, MUS_TITLE, MUS_START, MUS_STAGE_COMPLETE, MUS_DEATH];

const SND_MENU_MOVE = 16;
const SND_MENU_SELECT = 17;
const SND_HIT_WALL = 18;
const SND_HIT_TARGET = 19;
const SND_USED_WEAPON = 20;

const SOUNDS: i32[] = [SND_MENU_MOVE, SND_MENU_SELECT, SND_HIT_WALL, SND_HIT_TARGET, SND_USED_WEAPON];

// `snd in SOUNDS` and `msc in MUSIC` loop over the lists in place: passing
// a list to a function would copy it.
function playSound(snd: i32, looping: boolean = false): void {
  if (!gSoundOn) return;

  let known = false;
  for (let i = 0; i < len(SOUNDS); i++) if (SOUNDS[i] === snd) known = true;
  if (!known) return;

  // `pyxel.play_pos(3) != -1`: the game was written for Pyxel 1.4, where
  // play_pos returned -1 on an idle channel, so sounds wait for channel 3 to
  // be free. (Pyxel 2 returns None there, which silences every sound.)
  if (sound.isPlaying(3)) return;

  sound.play(3, snd, looping);
}

function playMusic(msc: i32, looping: boolean = false): void {
  if (!gMusicOn) return;

  let known = false;
  for (let i = 0; i < len(MUSIC); i++) if (MUSIC[i] === msc) known = true;
  if (!known) return;

  sound.stop();

  music.play(msc, looping);
}

// ---- circle.py, rect.py and utils.py -------------------------------------------

// Squared distances of 16.16 values do not fit in 32 bits: the overlap tests
// return early when the distance on one axis alone is too large, then square
// 12-bit fractions.

/** circle.overlap for 16.16 centers and radii. */
function circleOverlap(x1: i32, y1: i32, r1: i32, x2: i32, y2: i32, r2: i32): boolean {
  const dx = abs(x1 - x2),
    dy = abs(y1 - y2),
    radiusSum = r1 + r2;
  if (dx >= radiusSum || dy >= radiusSum) return false;
  const ex = dx >> 4,
    ey = dy >> 4,
    er = radiusSum >> 4;
  return ex * ex + ey * ey < er * er;
}

/** rect.contains_point for a 16.16 rectangle and point. */
function containsPoint(x: i32, y: i32, w: i32, h: i32, px: i32, py: i32): boolean {
  return x <= px && x + w >= px && y <= py && y + h >= py;
}

/** utils.circle_rect_overlap for a 16.16 circle and a rectangle in pixels. */
function circleRectOverlap(cx: i32, cy: i32, cr: i32, rx: i32, ry: i32, rw: i32, rh: i32): boolean {
  let closestX = cx;
  let closestY = cy;

  if (cx < rx * ONE) closestX = rx * ONE;
  else if (cx > (rx + rw) * ONE) closestX = (rx + rw) * ONE;

  if (cy < ry * ONE) closestY = ry * ONE;
  else if (cy > (ry + rh) * ONE) closestY = (ry + rh) * ONE;

  const dx = abs(closestX - cx),
    dy = abs(closestY - cy);
  if (dx >= cr || dy >= cr) return false;
  const ex = dx >> 4,
    ey = dy >> 4,
    er = cr >> 4;
  return ex * ex + ey * ey < er * er;
}

/** utils.get_tile_index: the tile at pixel (x, y) of the image, as a tilemap tile value. */
function getTileIndex(x: i32, y: i32): i32 {
  return tilemap.tile(x >> 3, y >> 3);
}

const POWERS_OF_TEN: i32[] = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000];

/**
 * utils.draw_number_shadowed: str(num).zfill(zeropad) in the 8 x 8 digits of
 * the image, for num >= 0. Digits come from subtracting powers of ten, since
 * the GBA divides in software.
 */
function drawNumberShadowed(x: i32, y: i32, num: i32, zeropad: i32 = 0): void {
  let digits = 1;
  while (digits < 10 && num >= POWERS_OF_TEN[digits]) digits++;
  const count = digits > zeropad ? digits : zeropad;

  let n = num;
  for (let i = 0; i < count; i++) {
    const place = count - 1 - i;
    let digit = 0;
    if (place < 10)
      while (n >= POWERS_OF_TEN[place]) {
        n -= POWERS_OF_TEN[place];
        digit++;
      }
    blt(x + i * 8, y, 0, 16 + digit * 8, 56, 8, 8, 8);
  }
}

// ---- palette.py --------------------------------------------------------------

const NUM_COLOURS = 4;

// Palettes are named by their index in ALL, four colors each.
const DEFAULT = 0;
const NUM_PALETTES = 5;
const ALL: i32[] = [
  color.NAVY, color.GREEN, color.LIME, color.WHITE, // DEFAULT
  color.PURPLE, color.RED, color.PINK, color.WHITE, // RED
  color.NAVY, color.DARK_BLUE, color.CYAN, color.WHITE, // BLUE
  color.BROWN, color.ORANGE, color.PEACH, color.WHITE, // BROWN
  color.BLACK, color.DARK_BLUE, color.GRAY, color.WHITE, // GREY
]; // prettier-ignore

const FADE_LEVEL_0 = -3; // all colours to darkest colour.
const FADE_LEVEL_1 = -2; // all but brightest to darkest colour.
const FADE_LEVEL_2 = -1; // all but two brightest to darkest colour.
const FADE_LEVEL_3 = 0; // no modification
const FADE_LEVEL_4 = 1; // all but two darkest to brightest colour.
const FADE_LEVEL_5 = 2; // all but darkest to brightest colour.
const FADE_LEVEL_6 = 3; // all colours to brightest colour.

const FADE_STEP_TICKS_DEFAULT = 5;
const FADE_STEP_TICKS_SLOW = 10;

// Fade and palette events call back a method when they finish; MicroTS has
// no function values, so callbacks are named by these ids (see runCallback).
const CB_NONE = 0;
const CB_START_GAME = 1; // game.start_game
const CB_CYCLE_PALETTE = 2; // game.cycle_palette
const CB_QUIT = 3; // pyxel.quit
const CB_RESTART_STAGE = 4; // game.restart_stage
const CB_GO_TO_NEXT_STAGE = 5; // game.go_to_next_stage
const CB_GO_TO_GAME_COMPLETE_STAGE = 6; // game.go_to_game_complete_stage
const CB_QUIT_TO_MAIN_MENU = 7; // game.quit_to_main_menu
const CB_STAGE_GO_TO_NEXT_STAGE = 8; // stage.go_to_next_stage

interface FadeEvent {
  ticksPerLevel: i32;
  ticks: i32;
  newLevel: i32;
  callback: i32;
}

// FadeControl
let currentLevel = FADE_LEVEL_3;
let fadeEvents: FadeEvent[] = [];

function fadeControlInit(): void {
  currentLevel = FADE_LEVEL_3;

  fadeEvents = [];
}

function fadeAddEvent(ticksPerLevel: i32, newLevel: i32, callback: i32 = CB_NONE): void {
  if (ticksPerLevel <= 0 || newLevel < FADE_LEVEL_0 || newLevel > FADE_LEVEL_6) return;

  push(fadeEvents, { ticksPerLevel: ticksPerLevel, ticks: 0, newLevel: newLevel, callback: callback });
}

function fadeControlUpdate(): void {
  if (len(fadeEvents) > 0) {
    fadeEvents[0].ticks += 1;

    if (fadeEvents[0].ticks === fadeEvents[0].ticksPerLevel) {
      fadeEvents[0].ticks = 0;
      const newLevel = fadeEvents[0].newLevel;
      if (currentLevel < newLevel) currentLevel += 1;
      else if (currentLevel > newLevel) currentLevel -= 1;

      if (currentLevel === newLevel) {
        // A callback only appends events, so the first one is still this one.
        const callback = fadeEvents[0].callback;
        if (callback !== CB_NONE) runCallback(callback);
        removeAt(fadeEvents, 0);
      }
    }
  }
}

interface PaletteEvent {
  ticks: i32;
  newPal: i32;
  callback: i32;
}

// PaletteControl
let currentPalette = DEFAULT;
let paletteEvents: PaletteEvent[] = [];

function palControlInit(): void {
  currentPalette = DEFAULT;

  paletteEvents = [];

  fadeControlInit();
}

function addFadeEvent(ticksPerLevel: i32, newLevel: i32, callback: i32 = CB_NONE): void {
  fadeAddEvent(ticksPerLevel, newLevel, callback);
}

function addPaletteEvent(ticks: i32, newPal: i32, callback: i32 = CB_NONE): void {
  if (ticks <= 0 || newPal < 0 || newPal >= NUM_PALETTES) return;

  push(paletteEvents, { ticks: ticks, newPal: newPal, callback: callback });
}

function palControlUpdate(): void {
  fadeControlUpdate();

  if (len(paletteEvents) > 0) {
    paletteEvents[0].ticks -= 1;
    if (paletteEvents[0].ticks === 0) {
      currentPalette = paletteEvents[0].newPal;
      const callback = paletteEvents[0].callback;
      if (callback !== CB_NONE) runCallback(callback);
      removeAt(paletteEvents, 0);
    }
  }
}

function getCol(index: i32): i32 {
  if (index < 0 || index >= NUM_COLOURS) return ALL[currentPalette * NUM_COLOURS];

  const level = math.clamp(index + currentLevel, 0, NUM_COLOURS - 1);

  return ALL[currentPalette * NUM_COLOURS + level];
}

// ---- screenshake.py ----------------------------------------------------------

interface ShakeEvent {
  ticks: i32;
  magnitude: i32;
}

let shakeX = 0;
let shakeY = 0;
let shakeEvents: ShakeEvent[] = [];

function screenShakeInit(): void {
  shakeX = 0;
  shakeY = 0;

  shakeEvents = [];
}

function shakeAddEvent(ticks: i32, magnitude: i32, queue: boolean = false): void {
  if (ticks < 0 || magnitude <= 0) return;

  if (len(shakeEvents) > 0 && !queue) return;

  push(shakeEvents, { ticks: ticks, magnitude: magnitude });
}

function screenShakeUpdate(): void {
  if (len(shakeEvents) > 0) {
    shakeEvents[0].ticks -= 1;
    if (shakeEvents[0].ticks === 0) {
      removeAt(shakeEvents, 0);
      shakeX = 0;
      shakeY = 0;
    } else {
      const magnitude = shakeEvents[0].magnitude;
      shakeX = math.rndi(-magnitude, magnitude);
      shakeY = math.rndi(-magnitude, magnitude);
    }
  }
}

// ---- light.py ----------------------------------------------------------------

const LIGHT_TICKS_PER_FRAME = 10;
const LIGHT_MAX_FRAMES = 5;

interface Light {
  x: i32;
  y: i32;
  frame: i32;
  frameTicks: i32;
  animDir: i32;
  isHit: boolean;
}

function newLight(x: i32, y: i32): Light {
  return { x: x, y: y, frame: 0, frameTicks: 0, animDir: 1, isHit: false };
}

function lightGotHit(i: i32): boolean {
  if (!lights[i].isHit) {
    lights[i].frame = 4;
    lights[i].isHit = true;
    addScore(SCORE_HIT_LIGHT);
    return true;
  }
  return false;
}

function lightUpdate(i: i32): void {
  if (!lights[i].isHit) {
    lights[i].frameTicks += 1;

    if (lights[i].frameTicks === LIGHT_TICKS_PER_FRAME) {
      lights[i].frameTicks = 0;
      lights[i].frame += lights[i].animDir;

      if (lights[i].frame === 0 || lights[i].frame === LIGHT_MAX_FRAMES - 1) lights[i].animDir *= -1;
    }
  }
}

function lightDraw(i: i32, sx: i32, sy: i32): void {
  blt(sx + lights[i].x, sy + lights[i].y, 0, 160 + lights[i].frame * 8, 0, 8, 8);
}

// ---- spinner.py --------------------------------------------------------------

const TYPE_AGGRESSIVE = 0;
const TYPE_RANDOM_SLOW = 2;
const TYPE_RANDOM_FAST = 3;

const SPINNER_TICKS_PER_FRAME = 10;
const SPINNER_MAX_FRAME = 4;

const SPINNER_MAX_SPEED = 26214; // 0.4
const MAX_RESPAWN_TICKS = 300; // 5 secs

interface Spinner {
  x: i32;
  y: i32;
  type: i32;
  vx: i32;
  vy: i32;
  radius: i32;
  frame: i32;
  frameTicks: i32;
  isDead: boolean;
  respawnTicks: i32;
}

/** random.choice([-MAX_SPEED, MAX_SPEED]) */
function randomSpinnerSpeed(): i32 {
  return math.rndi(0, 1) === 0 ? -SPINNER_MAX_SPEED : SPINNER_MAX_SPEED;
}

/** Spinner(x, y, type) at a spawn location in pixels. */
function newSpinner(x: i32, y: i32, type: i32): Spinner {
  const vx = randomSpinnerSpeed();
  const vy = randomSpinnerSpeed();
  return {
    x: x * ONE,
    y: y * ONE,
    type: type >= TYPE_AGGRESSIVE && type <= TYPE_RANDOM_FAST ? type : TYPE_RANDOM_SLOW,
    vx: vx,
    vy: vy,
    radius: 4 * ONE,
    frame: 0,
    frameTicks: 0,
    isDead: false,
    respawnTicks: MAX_RESPAWN_TICKS,
  };
}

function spinnerSetNewPosition(i: i32): void {
  const px = playerX;
  const py = playerY;
  // loclist without the player's sector: [TOPLEFT, BOTTOMLEFT, TOPRIGHT, BOTTOMRIGHT]
  let playerSector = SPAWN_SECTOR_BOTTOMRIGHT;
  if (px < 80 * ONE) {
    if (py < 75 * ONE) playerSector = SPAWN_SECTOR_TOPLEFT;
    else playerSector = SPAWN_SECTOR_BOTTOMLEFT;
  } else {
    if (py < 75 * ONE) playerSector = SPAWN_SECTOR_TOPRIGHT;
  }
  const loclist: i32[] = [];
  const order: i32[] = [SPAWN_SECTOR_TOPLEFT, SPAWN_SECTOR_BOTTOMLEFT, SPAWN_SECTOR_TOPRIGHT, SPAWN_SECTOR_BOTTOMRIGHT];
  for (let k = 0; k < 4; k++) if (order[k] !== playerSector) push(loclist, order[k]);

  // The index goes to a local first: an index that calls a function copies the list.
  const pick = math.rndi(0, len(loclist) - 1);
  const loc = getRandomSpawnLoc(loclist[pick]);
  spinners[i].x = loc.x * ONE;
  spinners[i].y = loc.y * ONE;
}

function spinnerKill(i: i32): void {
  spinners[i].isDead = true;
  spinners[i].respawnTicks = MAX_RESPAWN_TICKS;
}

function spinnerDoCollisions(i: i32): void {
  let newX = spinners[i].x + spinners[i].vx;

  for (let b = 0; b < len(solidRects); b++) {
    if (
      circleRectOverlap(
        newX,
        spinners[i].y,
        spinners[i].radius,
        solidRects[b].x,
        solidRects[b].y,
        solidRects[b].w,
        solidRects[b].h,
      )
    ) {
      if (spinners[i].x > (solidRects[b].x + solidRects[b].w) * ONE)
        // was prev to right of border.
        newX = (solidRects[b].x + solidRects[b].w) * ONE + spinners[i].radius;
      else if (spinners[i].x < solidRects[b].x * ONE)
        // was prev to left of border.
        newX = solidRects[b].x * ONE - spinners[i].radius;

      spinners[i].vx *= -1;
      break;
    }
  }

  let newY = spinners[i].y + spinners[i].vy;

  for (let b = 0; b < len(solidRects); b++) {
    if (
      circleRectOverlap(
        spinners[i].x,
        newY,
        spinners[i].radius,
        solidRects[b].x,
        solidRects[b].y,
        solidRects[b].w,
        solidRects[b].h,
      )
    ) {
      if (spinners[i].y > (solidRects[b].y + solidRects[b].h) * ONE)
        // was prev below border.
        newY = (solidRects[b].y + solidRects[b].h) * ONE + spinners[i].radius;
      else if (spinners[i].y < solidRects[b].y * ONE)
        // was prev above border.
        newY = solidRects[b].y * ONE - spinners[i].radius;

      spinners[i].vy *= -1;
      break;
    }
  }

  spinners[i].x = newX;
  spinners[i].y = newY;
}

function spinnerRespawn(i: i32): void {
  spinners[i].isDead = false;
}

function spinnerUpdate(i: i32): void {
  if (spinners[i].isDead) {
    spinners[i].respawnTicks -= 1;
    if (spinners[i].respawnTicks === 0) spinnerRespawn(i);
    else if (spinners[i].respawnTicks === 30) spinnerSetNewPosition(i);
  } else {
    spinnerDoCollisions(i);

    spinners[i].frameTicks += 1;
    if (spinners[i].frameTicks === SPINNER_TICKS_PER_FRAME) {
      spinners[i].frameTicks = 0;
      spinners[i].frame += 1;
      if (spinners[i].frame === SPINNER_MAX_FRAME) spinners[i].frame = 0;
    }
  }
}

function spinnerDraw(i: i32, sx: i32, sy: i32): void {
  if (spinners[i].isDead) {
    let framex = -1;
    if (spinners[i].respawnTicks < 10) framex = 42;
    else if (spinners[i].respawnTicks < 20) framex = 63;
    else if (spinners[i].respawnTicks < 30) framex = 84;
    if (framex >= 0)
      blt(toPx(spinners[i].x + (sx - 10) * ONE), toPx(spinners[i].y + (sy - 10) * ONE), 0, framex, 231, 21, 21, 8);
    else drawNothing();
  } else {
    blt(
      toPx(spinners[i].x + (sx - 4) * ONE),
      toPx(spinners[i].y + (sy - 4) * ONE),
      0,
      160 + spinners[i].frame * 9,
      8,
      9,
      9,
      8,
    );
  }
}

// ---- weapon.py ---------------------------------------------------------------

const MAX_SHOTS = 10;
const SHOT_RADIUS = 3 * ONE;
const SHOT_SPEED = 1.5;

// VEL[i] = SHOT_SPEED * (cos, sin)(i * 36 degrees), 16.16, made by initWeaponVel().
let velX: i32[] = [];
let velY: i32[] = [];

function initWeaponVel(): void {
  velX = [];
  velY = [];
  for (let i = 0; i < MAX_SHOTS; i++) {
    push(velX, math.round(f32(SHOT_SPEED) * math.cos(f32(i * 36)) * f32(ONE)));
    push(velY, math.round(f32(SHOT_SPEED) * math.sin(f32(i * 36)) * f32(ONE)));
  }
}

interface Shot {
  x: i32;
  y: i32;
}

// Weapon
let weaponActive = false;
let shots: Shot[] = [];

function weaponInit(): void {
  weaponActive = false;

  shots = [];
  for (let i = 0; i < MAX_SHOTS; i++) push(shots, { x: 0, y: 0 });
}

function weaponFire(fromX: i32, fromY: i32): void {
  weaponActive = true;
  for (let i = 0; i < MAX_SHOTS; i++) {
    shots[i].x = fromX;
    shots[i].y = fromY;
  }
}

function weaponUpdate(): void {
  if (!weaponActive) return;

  let done = true;

  for (let i = 0; i < MAX_SHOTS; i++) {
    shots[i].x += velX[i];
    shots[i].y += velY[i];

    if (done && containsPoint(0, 0, GAME_WIDTH * ONE, GAME_HEIGHT * ONE, shots[i].x, shots[i].y)) done = false;

    for (let s = 0; s < len(spinners); s++) {
      if (!spinners[s].isDead) {
        if (circleOverlap(shots[i].x, shots[i].y, SHOT_RADIUS, spinners[s].x, spinners[s].y, spinners[s].radius)) {
          addScore(SCORE_KILLED_SPINNER);
          spinnerKill(s);
        }
      }
    }
  }

  if (done) {
    let spinnersKilled = 0;
    for (let s = 0; s < len(spinners); s++) if (spinners[s].isDead) spinnersKilled++;
    if (spinnersKilled === len(spinners)) addScore(SCORE_KILLED_ALL_SPINNERS);
    weaponActive = false;
    playerWeaponDone();
  }
}

function weaponDraw(sx: i32, sy: i32): void {
  if (!weaponActive) return;

  for (let i = 0; i < MAX_SHOTS; i++)
    blt(toPx(shots[i].x + (sx - 10) * ONE), toPx(shots[i].y + (sy - 10) * ONE), 0, 21, 231, 21, 21, 8);
}

// ---- player.py ---------------------------------------------------------------

const MAX_SPEED = 78643; // 1.2
const DECEL = 655; // 0.01
const ACCEL = 3932; // 0.06
const SLOPE_ACCEL = 6554; // 0.10

// HIT_SOLID_DAMP = 0.7: see hitSolidDamp().

const INTRO_TICKS_PER_FRAME = 10;
const DEAD_TICKS_PER_FRAME = 10;

const PLAYER_STATE_INTRO = 0;
const PLAYER_STATE_PLAY = 1;
const PLAYER_STATE_DEAD = 2;
const PLAYER_STATE_STAGE_COMPLETE = 3;
const PLAYER_STATE_GAME_COMPLETE = 4;
const PLAYER_STATE_WEAPON = 5;

// Forces point at multiples of 45 degrees: cos and sin of k * 45 degrees, 16.16.
const COS_45: i32[] = [65536, 46341, 0, -46341, -65536, -46341, 0, 46341];
const SIN_45: i32[] = [0, 46341, 65536, 46341, 0, -46341, -65536, -46341];

let playerX = 0;
let playerY = 0;
let playerVx = 0;
let playerVy = 0;
let playerRadius = 4 * ONE;
let playerState = PLAYER_STATE_INTRO;
let introFrame = 4;
let deadFrame = 0;
let animTicks = 0;

/** Player(x, y) at a position in pixels. */
function playerInit(x: i32, y: i32): void {
  playerX = x * ONE;
  playerY = y * ONE;

  playerVx = 0;
  playerVy = 0;

  playerRadius = 4 * ONE;

  playerState = PLAYER_STATE_INTRO;

  introFrame = 4;
  deadFrame = 0;

  animTicks = 0;

  weaponInit();
}

/** v * -HIT_SOLID_DAMP */
function hitSolidDamp(v: i32): i32 {
  return -idiv(v * 7, 10);
}

function playerDoSolidCollisions(): void {
  let newX = playerX + playerVx;

  for (let b = 0; b < len(solidRects); b++) {
    if (
      circleRectOverlap(newX, playerY, playerRadius, solidRects[b].x, solidRects[b].y, solidRects[b].w, solidRects[b].h)
    ) {
      if (playerX > (solidRects[b].x + solidRects[b].w) * ONE)
        // was prev to right of border.
        newX = (solidRects[b].x + solidRects[b].w) * ONE + playerRadius;
      else if (playerX < solidRects[b].x * ONE)
        // was prev to left of border.
        newX = solidRects[b].x * ONE - playerRadius;

      playerVx = hitSolidDamp(playerVx);
      stagePlayerHitSolid();
      break;
    }
  }

  let newY = playerY + playerVy;

  for (let b = 0; b < len(solidRects); b++) {
    if (
      circleRectOverlap(playerX, newY, playerRadius, solidRects[b].x, solidRects[b].y, solidRects[b].w, solidRects[b].h)
    ) {
      if (playerY > (solidRects[b].y + solidRects[b].h) * ONE)
        // was prev below border.
        newY = (solidRects[b].y + solidRects[b].h) * ONE + playerRadius;
      else if (playerY < solidRects[b].y * ONE)
        // was prev above border.
        newY = solidRects[b].y * ONE - playerRadius;

      playerVy = hitSolidDamp(playerVy);
      stagePlayerHitSolid();
      break;
    }
  }

  playerX = newX;
  playerY = newY;
}

/** The angle of the pressed direction in degrees, or -1 (None). */
function getInputAngle(): i32 {
  let pressAngle = -1;
  if (isPressing(LEFT)) pressAngle = 180;
  else if (isPressing(RIGHT)) pressAngle = 0;

  if (isPressing(UP)) {
    if (pressAngle === 0) pressAngle = 315;
    else if (pressAngle === 180) pressAngle = 225;
    else pressAngle = 270;
  } else if (isPressing(DOWN)) {
    if (pressAngle === 0) pressAngle = 45;
    else if (pressAngle === 180) pressAngle = 135;
    else pressAngle = 90;
  }

  return pressAngle;
}

/** speed * cos or sin of an angle, both 16.16, rounded half away from zero. */
function forceComponent(speed: i32, unit: i32): i32 {
  const p = speed * unit;
  return p >= 0 ? (p + HALF) >> 16 : -((-p + HALF) >> 16);
}

/**
 * _apply_forces for one force [speed, angle]; the original applies the list
 * of forces in order, which update() does by calling this once per force.
 */
function applyForce(speed: i32, angle: i32): void {
  const k = idiv(angle, 45);
  playerVx = math.clamp(playerVx + forceComponent(speed, COS_45[k]), -MAX_SPEED, MAX_SPEED);
  playerVy = math.clamp(playerVy + forceComponent(speed, SIN_45[k]), -MAX_SPEED, MAX_SPEED);
}

/** _get_tile_force: the slope's angle, or -1. */
function getTileForce(): i32 {
  return getTileAngle(playerX, playerY);
}

function isStuckInPocket(): boolean {
  // abs(v) > 0.01
  if (abs(playerVx) > DECEL || abs(playerVy) > DECEL) return false;

  for (let p = 0; p < len(pockets); p++)
    if (containsPoint(pockets[p].x * ONE, pockets[p].y * ONE, pockets[p].w * ONE, pockets[p].h * ONE, playerX, playerY))
      return true;
  return false;
}

function playerDoEnemyCollisions(): void {
  for (let s = 0; s < len(spinners); s++) {
    if (spinners[s].isDead) continue;
    if (circleOverlap(spinners[s].x, spinners[s].y, spinners[s].radius, playerX, playerY, playerRadius)) {
      playerState = PLAYER_STATE_DEAD;
      stagePlayerHit();
      return;
    }
  }
}

function playerDoLightCollisions(): void {
  for (let s = 0; s < len(lights); s++) {
    if (containsPoint(lights[s].x * ONE, lights[s].y * ONE, 8 * ONE, 8 * ONE, playerX, playerY)) {
      if (lightGotHit(s)) {
        playSound(SND_HIT_TARGET);
        if (stageIsComplete()) {
          playerState = PLAYER_STATE_STAGE_COMPLETE;
          addScore(SCORE_STAGE_COMPLETE);
        }
      }
      return;
    }
  }
}

function playerFireWeapon(): void {
  weaponFire(playerX, playerY);
  playerState = PLAYER_STATE_WEAPON;
  gLives -= 1;
  stagePlayerUsedWeapon();
  addScore(SCORE_USE_WEAPON);
}

function playerWeaponDone(): void {
  playerState = PLAYER_STATE_INTRO;
  introFrame = 4;
  animTicks = 0;
  playerVx = 0;
  playerVy = 0;
}

function playerUpdate(): void {
  if (playerState === PLAYER_STATE_INTRO) {
    animTicks += 1;
    if (animTicks === INTRO_TICKS_PER_FRAME) {
      animTicks = 0;
      if (introFrame > -1) {
        introFrame -= 1;

        if (introFrame === -1) {
          introFrame = 4;
          playerState = PLAYER_STATE_PLAY;
          stagePlayerIntroDone();
        }
      }
    }
    return;
  } else if (playerState === PLAYER_STATE_DEAD) {
    animTicks += 1;
    if (animTicks === DEAD_TICKS_PER_FRAME) {
      animTicks = 0;

      if (deadFrame < 11) {
        deadFrame += 1;

        if (deadFrame === 11) stagePlayerDeathAnimDone();
      }
    }
    return;
  } else if (playerState === PLAYER_STATE_STAGE_COMPLETE) {
    return;
  } else if (playerState === PLAYER_STATE_WEAPON) {
    weaponUpdate();
    return;
  }

  // forces: [ACCEL, input angle], then [SLOPE_ACCEL, tile angle]
  const inputAngle = getInputAngle();
  const tileAngle = !isStuckInPocket() ? getTileForce() : -1;

  if (inputAngle >= 0) applyForce(ACCEL, inputAngle);
  if (tileAngle >= 0) applyForce(SLOPE_ACCEL, tileAngle);

  if (playerVx > 0) playerVx = playerVx - DECEL > 0 ? playerVx - DECEL : 0;
  else if (playerVx < 0) playerVx = playerVx + DECEL < 0 ? playerVx + DECEL : 0;

  if (playerVy > 0) playerVy = playerVy - DECEL > 0 ? playerVy - DECEL : 0;
  else if (playerVy < 0) playerVy = playerVy + DECEL < 0 ? playerVy + DECEL : 0;

  playerDoSolidCollisions();

  playerDoEnemyCollisions();

  if (playerState !== PLAYER_STATE_DEAD && playerState !== PLAYER_STATE_GAME_COMPLETE) {
    playerDoLightCollisions();

    if (isPressed(BUTTON_A) && playerState !== PLAYER_STATE_WEAPON && gLives > 0) playerFireWeapon();
  }
}

function playerDraw(sx: i32, sy: i32): void {
  if (playerState === PLAYER_STATE_INTRO) {
    blt(toPx(playerX + (sx - 10) * ONE), toPx(playerY + (sy - 10) * ONE), 0, introFrame * 21, 231, 21, 21, 8);
  } else if (playerState === PLAYER_STATE_DEAD) {
    blt(toPx(playerX + (sx - 10) * ONE), toPx(playerY + (sy - 10) * ONE), 0, deadFrame * 21, 231, 21, 21, 8);
  } else if (playerState === PLAYER_STATE_WEAPON) {
    weaponDraw(sx, sy);
  } else {
    blt(toPx(playerX + sx * ONE - playerRadius), toPx(playerY + sy * ONE - playerRadius), 0, 16, 33, 9, 9, 8);
  }
}

// ---- stagedata.py ------------------------------------------------------------

const DIFF_NONE = 0;
const DIFF_VERY_EASY = 1;
const DIFF_EASY = 2;
const DIFF_MEDIUM = 3;
const DIFF_HARD = 4;
const DIFF_VERY_HARD = 5;

// ENEMIES[difficulty]["spinners"]: [aggressive, mildly aggressive, slow random, fast random]
const ENEMIES: i32[] = [
  0, 0, 0, 0, // DIFF_NONE
  2, 1, 1, 0, // DIFF_VERY_EASY  # [1,1,1,0]
  2, 1, 2, 0, // DIFF_EASY  # [1,1,2,0]
  3, 1, 1, 1, // DIFF_MEDIUM  # [2,1,1,1]
  3, 1, 1, 2, // DIFF_HARD  # [2,1,1,2]
  3, 2, 1, 1, // DIFF_VERY_HARD  # [2,2,1,1]
]; // prettier-ignore

const STAGE_DIFFICULTY: i32[] = [
  DIFF_NONE, // 0
  DIFF_VERY_EASY, // 1
  DIFF_EASY, // 2
  DIFF_EASY, // 3
  DIFF_EASY, // 4
  DIFF_EASY, // 5
  DIFF_MEDIUM, // 6
  DIFF_EASY, // 7
  DIFF_MEDIUM, // 8
  DIFF_VERY_EASY, // 9
  DIFF_VERY_HARD, // 10
  DIFF_HARD, // 11
  DIFF_VERY_HARD, // 12
  DIFF_EASY, // 13
  DIFF_VERY_HARD, // 14
  DIFF_VERY_HARD, // 15
];

// ---- stage.py ----------------------------------------------------------------

const MAX_STAGE_NUM = 15;

const WIDTH_TILES = 18;
const HEIGHT_TILES = 15;

// Tiles by their pixel position in the image, as utils.get_tile_index(x, y).
const POST_TILE_X = 40;
const POST_TILE_Y = 32;

// SLOPE_TILES: tile at (x, y) in the image : [angle, collision matrix if triangle]
const SLOPE_TILE_X: i32[] = [56, 64, 72, 56, 72, 56, 64, 72, 80, 88, 80, 88];
const SLOPE_TILE_Y: i32[] = [32, 32, 32, 40, 40, 48, 48, 48, 32, 32, 40, 40];
const SLOPE_ANGLE: i32[] = [
  225, // top-left
  270, // top
  315, // top-right
  180, // left
  0, // right
  135, // bottom-left
  90, // bottom
  45, // bottom-right
  225, // top-left 2
  135, // bottom-left 2
  45, // bottom-right 2
  315, // top-right 2
];
const SLOPE_MATRIX: i32[] = [
  COLLIDE_BOTTOM_RIGHT,
  COLLIDE_NONE,
  COLLIDE_BOTTOM_LEFT,
  COLLIDE_NONE,
  COLLIDE_NONE,
  COLLIDE_TOP_RIGHT,
  COLLIDE_NONE,
  COLLIDE_TOP_LEFT,
  COLLIDE_TOP_LEFT,
  COLLIDE_BOTTOM_LEFT,
  COLLIDE_BOTTOM_RIGHT,
  COLLIDE_TOP_RIGHT,
];

// The tiles above as tilemap tile values, made once by initTiles(); the
// index in SLOPE_TILES of each tile of the image, or -1.
let slopeIndex: i32[] = [];
let postTile = 0;
let lightTile = 0;
let pocketTileNw = 0;
let pocketTileNe = 0;
let pocketTileSe = 0;
let pocketTileSw = 0;

function initTiles(): void {
  slopeIndex = fill(32 * 32, -1);
  for (let i = 0; i < len(SLOPE_TILE_X); i++) slopeIndex[(SLOPE_TILE_Y[i] >> 3) * 32 + (SLOPE_TILE_X[i] >> 3)] = i;
  postTile = getTileIndex(POST_TILE_X, POST_TILE_Y);
  lightTile = getTileIndex(LIGHT_TILE_X, LIGHT_TILE_Y);
  pocketTileNw = getTileIndex(POCKET_TILE_NW_X, POCKET_TILE_NW_Y);
  pocketTileNe = getTileIndex(POCKET_TILE_NE_X, POCKET_TILE_NE_Y);
  pocketTileSe = getTileIndex(POCKET_TILE_SE_X, POCKET_TILE_SE_Y);
  pocketTileSw = getTileIndex(POCKET_TILE_SW_X, POCKET_TILE_SW_Y);
}

/** The index of a tile in SLOPE_TILES, or -1 (tile not in SLOPE_TILES). */
function slopeTile(tile: i32): i32 {
  const tx = tilemap.tileX(tile),
    ty = tilemap.tileY(tile);
  return tx < 32 && ty < 32 ? slopeIndex[ty * 32 + tx] : -1;
}

const POCKET_TILE_NW_X = 80;
const POCKET_TILE_NW_Y = 40;
const POCKET_TILE_NE_X = 88;
const POCKET_TILE_NE_Y = 32;
const POCKET_TILE_SE_X = 80;
const POCKET_TILE_SE_Y = 32;
const POCKET_TILE_SW_X = 88;
const POCKET_TILE_SW_Y = 40;

const LIGHT_TILE_X = 160;
const LIGHT_TILE_Y = 0;

// PauseMenu
const SEL_RESUME = 0;
const SEL_PAUSE_PALETTE = 1;
const SEL_QUIT = 2;

// PauseMenu.SELECTIONS: [x, y, w, h] each
const PAUSE_SELECTIONS: i32[] = [
  56, 55, 48, 8, // SEL_RESUME
  52, 71, 56, 8, // SEL_PALETTE
  64, 87, 32, 8, // SEL_QUIT
]; // prettier-ignore
const NUM_PAUSE_SELECTIONS = 3;

let pauseIsVisible = false;
let pauseSelIndex = 0;
let pauseQuitting = false;

function pauseMenuInit(): void {
  pauseIsVisible = false;

  pauseSelIndex = 0;

  pauseQuitting = false;
}

function pausePressedSelect(): void {
  if (pauseSelIndex === SEL_RESUME) {
    pauseIsVisible = false;
  } else if (pauseSelIndex === SEL_PAUSE_PALETTE) {
    gameAddFade(5, FADE_LEVEL_6, CB_CYCLE_PALETTE);
  } else if (pauseSelIndex === SEL_QUIT) {
    pauseQuitting = true;
    stageQuit();
  }
}

function pauseChangeSelection(dir: i32): void {
  pauseSelIndex += dir;
  if (pauseSelIndex < 0) pauseSelIndex = NUM_PAUSE_SELECTIONS - 1;
  else if (pauseSelIndex >= NUM_PAUSE_SELECTIONS) pauseSelIndex = 0;
}

function pauseMenuUpdate(): void {
  if (!pauseIsVisible || pauseQuitting) return;

  if (isPressed(BUTTON_START) || isPressed(BUTTON_A)) pausePressedSelect();
  else if (isPressed(UP)) pauseChangeSelection(-1);
  else if (isPressed(DOWN)) pauseChangeSelection(1);
}

function pauseMenuDraw(sx: i32, sy: i32): void {
  if (!pauseIsVisible) return;

  blt(sx + 24, sy + 52, 0, 0, 144, 116, 52, 8); // panel bg

  blt(sx + 56, sy + 56, 0, 128, 72, 48, 8, 8); // resume
  blt(sx + 52, sy + 72, 0, 104, 80, 56, 8, 8); // palette
  blt(sx + 64, sy + 88, 0, 96, 64, 32, 8, 8); // quit

  const sel = pauseSelIndex * 4;
  blt(sx + PAUSE_SELECTIONS[sel] - 12, sy + PAUSE_SELECTIONS[sel + 1], 0, 16, 33, 9, 9, 8); // selection ball left
  blt(sx + PAUSE_SELECTIONS[sel] + PAUSE_SELECTIONS[sel + 2] + 2, sy + PAUSE_SELECTIONS[sel + 1], 0, 16, 33, 9, 9, 8); // selection ball right
}

const STATE_INTRO = 0;
const STATE_PLAY = 1;
const STATE_DIED = 2;
const STATE_DEMO = 3;
const STATE_GAME_OVER = 4;
const STATE_STAGE_COMPLETE = 5;
const STATE_GAME_COMPLETE = 6;
const STATE_PLAYER_WEAPON = 7;

const MAX_SHOW_GAME_OVER_TICKS = 300; // 5 secs
const MAX_SHOW_GAME_COMPLETE_TICKS = 300; // 5 secs

const SPAWN_SECTOR_TOPLEFT = 0;
const SPAWN_SECTOR_TOPRIGHT = 1;
const SPAWN_SECTOR_BOTTOMLEFT = 2;
const SPAWN_SECTOR_BOTTOMRIGHT = 3;

interface Rect {
  x: i32;
  y: i32;
  w: i32;
  h: i32;
}

interface Loc {
  x: i32;
  y: i32;
}

// Stage
let stageNum = 0;
let stageTm = 0;
let stageTmu = 0;
let stageTmv = 0;
let stageState = STATE_DEMO;
let solidRects: Rect[] = []; // [x, y, w, h]
let slopes: Loc[] = []; // [x, y]
let pockets: Rect[] = []; // [x, y, w, h]
let lights: Light[] = []; // Light objects
let spinners: Spinner[] = []; // Spinner objects
let enSpawnLocsTopleft: Loc[] = []; // [[x,y],[x,y],[x,y]...]
let enSpawnLocsTopright: Loc[] = []; // [[x,y],[x,y],[x,y]...]
let enSpawnLocsBottomleft: Loc[] = []; // [[x,y],[x,y],[x,y]...]
let enSpawnLocsBottomright: Loc[] = []; // [[x,y],[x,y],[x,y]...]
let stageOverTicks = 0;
let nextStageFlashNum = 0;

/** Stage(game, num): replaces the stage, as `self.stage = stage.Stage(self, num)` does. */
function stageInit(num: i32): void {
  stageNum = num;
  stageTm = 0;
  stageTmu = 0;
  stageTmv = num * 16;

  stageState = STATE_INTRO;
  if (stageNum <= 0) {
    stageState = STATE_DEMO;
  } else if (stageNum === MAX_STAGE_NUM + 1) {
    stageTm = 1;
    stageTmu = 0;
    stageTmv = 0;
    stageState = STATE_GAME_COMPLETE;
  }

  // The lists are cleared rather than made anew, which keeps their storage.
  clear(solidRects);
  push(solidRects, { x: 0, y: 0, w: 160, h: 16 }); // [x, y, w, h]
  push(solidRects, { x: 0, y: 16, w: 8, h: 128 });
  push(solidRects, { x: 152, y: 16, w: 8, h: 128 });
  push(solidRects, { x: 0, y: 136, w: 160, h: 8 });

  clear(slopes);
  clear(pockets);
  clear(lights);
  clear(spinners);

  clear(enSpawnLocsTopleft);
  clear(enSpawnLocsTopright);
  clear(enSpawnLocsBottomleft);
  clear(enSpawnLocsBottomright);

  if (stageState !== STATE_GAME_COMPLETE) {
    // The tile scan, made for every stage before the first frame (scanStage):
    // the lists are rebuilt in the order the scan finds their tiles.
    let k = scanStart[num];
    for (let n = scanData[k]; n > 0; n--) {
      k++;
      push(solidRects, { x: (scanData[k] & 31) * 8 + 8, y: (scanData[k] >> 5) * 8 + 16, w: 8, h: 8 });
    }
    k++;
    for (let n = scanData[k]; n > 0; n--) {
      k++;
      push(slopes, { x: (scanData[k] & 31) * 8 + 8, y: (scanData[k] >> 5) * 8 + 16 });
    }
    k++;
    for (let n = scanData[k]; n > 0; n--) {
      k++;
      push(lights, newLight((scanData[k] & 31) * 8 + 8, (scanData[k] >> 5) * 8 + 16));
    }
    k++;
    for (let n = scanData[k]; n > 0; n--) {
      k++;
      push(pockets, { x: (scanData[k] & 31) * 8 + 8, y: (scanData[k] >> 5) * 8 + 16, w: 16, h: 16 });
    }
    k++;
    // Enemy spawn cells: one bit per cell of spawnCells, in scan order.
    for (let c = 0; c < len(spawnCells); c++) {
      if ((scanData[k + (c >> 5)] & (1 << (c & 31))) === 0) continue;
      const xc = spawnCells[c] & 31,
        yc = spawnCells[c] >> 5;
      const loc: Loc = { x: xc * 8 + 8 + 4, y: yc * 8 + 16 + 4 };

      if (xc < 9) {
        if (yc < 7) push(enSpawnLocsTopleft, loc);
        else push(enSpawnLocsBottomleft, loc);
      } else {
        if (yc < 7) push(enSpawnLocsTopright, loc);
        else push(enSpawnLocsBottomright, loc);
      }
    }

    const stageDiff = STAGE_DIFFICULTY[stageNum];
    for (let i = 0; i < 4; i++) {
      const enQty = ENEMIES[stageDiff * 4 + i];
      for (let sq = 0; sq < enQty; sq++) {
        const loc = getRandomSpawnLoc(-1);
        push(spinners, newSpinner(loc.x, loc.y, i));
      }
    }
  }

  playerInit(75, 75); // (12, 20)
  if (stageState === STATE_GAME_COMPLETE) {
    playerState = PLAYER_STATE_GAME_COMPLETE;
    playMusic(MUS_IN_GAME, true);
  } else {
    if (stageState !== STATE_DEMO) playMusic(MUS_START, false);
  }

  pauseMenuInit();

  stageOverTicks = 0;

  nextStageFlashNum = 0;
}

// Stage.__init__'s loop over the tiles of a stage finds its posts, slopes,
// lights, pockets and enemy spawn cells; it runs once per stage before the
// first frame, as it costs a third of a frame. From scanStart[num], scanData
// holds each of the first four lists as its length and then its tiles, each
// as column | row << 5 (xc, yc), in the order the loop finds them; then two
// words of bits, one per cell of spawnCells, for the spawn cells.
let scanData: i32[] = [];
let scanStart: i32[] = [];
// The cells Stage.__init__ considers for enemy spawns, in scan order.
let spawnCells: i32[] = [];

function initStageScans(): void {
  for (let yc = 0; yc < HEIGHT_TILES; yc++)
    for (let xc = 0; xc < WIDTH_TILES; xc++)
      if (
        xc > 0 &&
        xc < WIDTH_TILES - 1 &&
        yc > 0 &&
        yc < HEIGHT_TILES - 1 &&
        (xc < 5 || xc > WIDTH_TILES - 6) &&
        (yc < 5 || yc > HEIGHT_TILES - 6)
      )
        push(spawnCells, xc | (yc << 5));
  // What the loop finds at each cell xc | yc << 5, a bit per list: 1 post,
  // 2 slope, 4 light, 8 pocket.
  const found: i32[] = fill(HEIGHT_TILES << 5, 0);
  for (let num = 0; num <= MAX_STAGE_NUM; num++) {
    push(scanStart, len(scanData));
    for (let yc = 0; yc < HEIGHT_TILES; yc++)
      for (let xc = 0; xc < WIDTH_TILES; xc++) {
        const tile = stageTile(num, xc, yc);
        let bits = 0;
        if (tile === postTile) bits = 1;
        else if (slopeTile(tile) >= 0) bits = 2;
        else if (tile === lightTile) bits = 4;
        if (
          tile === pocketTileNw &&
          xc < WIDTH_TILES - 1 &&
          yc < HEIGHT_TILES - 1 &&
          stageTile(num, xc + 1, yc) === pocketTileNe &&
          stageTile(num, xc + 1, yc + 1) === pocketTileSe &&
          stageTile(num, xc, yc + 1) === pocketTileSw
        )
          bits |= 8;
        found[xc | (yc << 5)] = bits;
      }
    for (let bit = 1; bit <= 8; bit <<= 1) {
      const countAt = len(scanData);
      push(scanData, 0);
      for (let c = 0; c < len(found); c++) if ((found[c] & bit) !== 0) push(scanData, c);
      scanData[countAt] = len(scanData) - countAt - 1;
    }
    const spawnAt = len(scanData);
    push(scanData, 0);
    push(scanData, 0);
    for (let c = 0; c < len(spawnCells); c++)
      if ((found[spawnCells[c]] & 1) === 0) scanData[spawnAt + (c >> 5)] |= 1 << (c & 31);
  }
}

/** The tile of stage num (tilemap 0) at column xc and row yc of its window. */
function stageTile(num: i32, xc: i32, yc: i32): i32 {
  return tilemap.pget(0, xc, num * 16 + yc);
}

function stageRestartMusic(): void {
  if (stageState === STATE_PLAY) playMusic(MUS_IN_GAME);
}

/** random.choice(list) of a spawn sector, or of a random sector for -1. */
function getRandomSpawnLoc(sector: i32): Loc {
  let s = sector;
  if (s < SPAWN_SECTOR_TOPLEFT || s > SPAWN_SECTOR_BOTTOMRIGHT) {
    // random.choice([topleft, topright, bottomleft, bottomright])
    s = math.rndi(0, 3);
  }
  // Each index goes to a local first: an index that calls a function copies the list.
  if (s === SPAWN_SECTOR_TOPLEFT) {
    const k = math.rndi(0, len(enSpawnLocsTopleft) - 1);
    return enSpawnLocsTopleft[k];
  } else if (s === SPAWN_SECTOR_TOPRIGHT) {
    const k = math.rndi(0, len(enSpawnLocsTopright) - 1);
    return enSpawnLocsTopright[k];
  } else if (s === SPAWN_SECTOR_BOTTOMLEFT) {
    const k = math.rndi(0, len(enSpawnLocsBottomleft) - 1);
    return enSpawnLocsBottomleft[k];
  }
  const k = math.rndi(0, len(enSpawnLocsBottomright) - 1);
  return enSpawnLocsBottomright[k];
}

function stagePlayerUsedWeapon(): void {
  playSound(SND_USED_WEAPON);
  stageState = STATE_PLAYER_WEAPON;
}

function stagePlayerIntroDone(): void {
  if (stageState !== STATE_PLAYER_WEAPON) playMusic(MUS_IN_GAME, true);

  stageState = STATE_PLAY;
}

function stagePlayerHit(): void {
  stageState = STATE_DIED;
  playMusic(MUS_DEATH, false);
}

function stageIsComplete(): boolean {
  for (let i = 0; i < len(lights); i++) if (!lights[i].isHit) return false;

  playMusic(MUS_STAGE_COMPLETE, false);
  stageCheckNextStage();

  return true;
}

function stagePlayerDeathAnimDone(): void {
  if (gLives >= 1) {
    gLives -= 1;
    gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_6, CB_RESTART_STAGE);
  } else {
    stageState = STATE_GAME_OVER;
    playMusic(MUS_GAME_OVER, false);
  }
}

function stageCheckNextStage(): void {
  // if self.num < MAX_STAGE_NUM:
  stageState = STATE_STAGE_COMPLETE;
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_0, CB_STAGE_GO_TO_NEXT_STAGE);
  // else:
  //    self.state = STATE_GAME_COMPLETE
}

function stageGoToNextStage(): void {
  if (nextStageFlashNum === 0) {
    gameAddFade(FADE_STEP_TICKS_SLOW, FADE_LEVEL_3, CB_STAGE_GO_TO_NEXT_STAGE);
  } else if (nextStageFlashNum === 1) {
    gameAddFade(FADE_STEP_TICKS_SLOW, FADE_LEVEL_0, CB_STAGE_GO_TO_NEXT_STAGE);
  } else {
    if (stageNum === MAX_STAGE_NUM) {
      gameAddFade(FADE_STEP_TICKS_SLOW, FADE_LEVEL_6, CB_GO_TO_GAME_COMPLETE_STAGE);
    } else {
      addLives(1);
      gameAddFade(FADE_STEP_TICKS_SLOW, FADE_LEVEL_6, CB_GO_TO_NEXT_STAGE);
    }
  }

  nextStageFlashNum += 1;
}

function stageQuit(): void {
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_6, CB_QUIT_TO_MAIN_MENU);
}

function stagePlayerHitSolid(): void {
  playSound(SND_HIT_WALL);
  gameAddScreenShake(5, 1, false);
}

/** The slope angle under screen pixel (x, y) (16.16), or -1 (None). */
function getTileAngle(x: i32, y: i32): i32 {
  // math.floor of the coordinates
  const px = x >> 16,
    py = y >> 16;
  const tile = tilemap.pget(stageTm, stageTmu + ((px - 8) >> 3), stageTmv + ((py - 16) >> 3));

  const t = slopeTile(tile);
  if (t >= 0) {
    // check if triangle matrix collision check needed.
    if (SLOPE_MATRIX[t] !== COLLIDE_NONE) {
      const tx = px & 7;
      const ty = py & 7;

      if (isCollidingMatrix(tx, ty, SLOPE_MATRIX[t])) return SLOPE_ANGLE[t];
      else return -1;
    } else {
      return SLOPE_ANGLE[t];
    }
  } else {
    return -1;
  }
}

function stageUpdate(): void {
  if (stageNum > 0) {
    // dont allow inputs on demo/main menu stage 0.
    if (pauseIsVisible) {
      pauseMenuUpdate();
    } else {
      if (isPressed(BUTTON_START) || isPressed(BUTTON_B)) {
        if (stageState === STATE_PLAY || stageState === STATE_PLAYER_WEAPON) pauseIsVisible = true;
      } else {
        playerUpdate();

        if (stageState === STATE_PLAY || stageState === STATE_DEMO)
          for (let s = 0; s < len(spinners); s++) spinnerUpdate(s);
      }

      if (stageState === STATE_GAME_OVER) {
        stageOverTicks += 1;
        if (stageOverTicks === MAX_SHOW_GAME_OVER_TICKS) stageQuit();
      } else if (stageState === STATE_GAME_COMPLETE) {
        stageOverTicks += 1;
        if (stageOverTicks >= MAX_SHOW_GAME_COMPLETE_TICKS) {
          if (isPressed(BUTTON_A)) stageQuit();
        }
      }
    }
  }

  if (stageState === STATE_PLAY || stageState === STATE_DEMO) for (let i = 0; i < len(lights); i++) lightUpdate(i);
}

function stageDraw(sx: i32, sy: i32): void {
  section(SEC_STAGE);
  // The tilemap, from its picture once made (see Stage pictures below).
  const slot = pictureSlot(stageNum);
  if (slot >= 0) blt(sx + 8, sy + 16, slotBank(slot), 0, slotY(slot), WIDTH_TILES * 8, HEIGHT_TILES * 8);
  else bltm(sx + 8, sy + 16, stageTm, stageTmu * 8, stageTmv * 8, WIDTH_TILES * 8, HEIGHT_TILES * 8, 8);

  section(SEC_LIGHTS);
  for (let i = 0; i < len(lights); i++) lightDraw(i, sx, sy);

  section(SEC_COMPLETE);
  if (stageState === STATE_GAME_COMPLETE) blt(24 + sx, 32 + sy, 0, 136, 136, 112, 88);

  section(SEC_PLAYER);
  if (stageNum > 0) playerDraw(sx, sy);

  section(SEC_SPINNERS);
  for (let s = 0; s < len(spinners); s++) spinnerDraw(s, sx, sy);

  section(SEC_PAUSE);
  if (stageNum > 0) pauseMenuDraw(sx, sy);

  section(SEC_GAME_OVER);
  if (stageState === STATE_GAME_OVER && stageOverTicks > 30) {
    blt(32 + sx, 66 + sy, 0, 0, 196, 100, 26, 8); // game over bg
    blt(44 + sx, 72 + sy, 0, 40, 80, 32, 8, 8); // "game"
    blt(84 + sx, 72 + sy, 0, 72, 80, 32, 8, 8); // "over"
  }
}

// ---- hud.py ------------------------------------------------------------------

function hudDraw(sx: i32, sy: i32): void {
  section(SEC_HUD);
  // top bar
  blt(sx + 0, sy + 0, 0, 0, 0, GAME_WIDTH, 16);
  // bottom bar
  blt(sx + 0, sy + 136, 0, 0, 16, GAME_WIDTH, 8);
  // left bar
  blt(sx + 0, sy + 16, 0, 0, 24, 8, 120);
  // right bar
  blt(sx + 152, sy + 16, 0, 8, 24, 8, 120);

  drawNumberShadowed(sx + 31, sy + 5, gLives, 2);
  drawNumberShadowed(sx + 57, sy + 5, gScore, 6);
  drawNumberShadowed(sx + 113, sy + 5, gStageNum, 2);
  drawNumberShadowed(sx + 137, sy + 5, MAX_STAGE_NUM, 2);
}

// ---- mainmenu.py -------------------------------------------------------------

const SEL_START_GAME = 0;
const SEL_PALETTE = 1;
const SEL_EXIT_GAME = 2;

// SELECTIONS: [x, y, w, h] each
const SELECTIONS: i32[] = [
  40, 87, 80, 8, // SEL_START_GAME
  52, 103, 56, 8, // SEL_PALETTE
  44, 119, 72, 8, // SEL_EXIT_GAME
]; // prettier-ignore
const NUM_SELECTIONS = 3;

let menuIsVisible = true;
let showPressStart = true;
let pressStartFlashTicks = 0;
let menuSelIndex = 0;

function mainMenuInit(): void {
  menuIsVisible = true;

  showPressStart = true;
  pressStartFlashTicks = 0;
  menuSelIndex = 0;
}

function mainMenuHide(): void {
  menuIsVisible = false;
}

function mainMenuReset(): void {
  menuIsVisible = true;
  showPressStart = true;
  pressStartFlashTicks = 0;
  menuSelIndex = 0;
  playMusic(MUS_TITLE, true);
}

function menuPressedSelect(): void {
  playSound(SND_MENU_SELECT);
  if (menuSelIndex === SEL_START_GAME) {
    gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_6, CB_START_GAME);
  } else if (menuSelIndex === SEL_PALETTE) {
    gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_6, CB_CYCLE_PALETTE);
  } else if (menuSelIndex === SEL_EXIT_GAME) {
    gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_0, CB_QUIT);
  }
}

function menuChangeSelection(dir: i32): void {
  playSound(SND_MENU_MOVE);
  menuSelIndex += dir;
  if (menuSelIndex < 0) menuSelIndex = NUM_SELECTIONS - 1;
  else if (menuSelIndex >= NUM_SELECTIONS) menuSelIndex = 0;
}

function mainMenuUpdate(): void {
  if (!menuIsVisible) return;

  if (showPressStart) {
    pressStartFlashTicks += 1;
    if (pressStartFlashTicks === 50) pressStartFlashTicks = 0;
    if (isPressed(BUTTON_START) || isPressed(BUTTON_A)) {
      showPressStart = false;
      menuSelIndex = 0;
    }
  } else {
    if (isPressed(BUTTON_START) || isPressed(BUTTON_A)) menuPressedSelect();
    else if (isPressed(UP)) menuChangeSelection(-1);
    else if (isPressed(DOWN)) menuChangeSelection(1);
  }
}

function mainMenuDraw(sx: i32, sy: i32): void {
  if (!menuIsVisible) return;

  section(SEC_MENU_START);
  if (showPressStart) {
    if (pressStartFlashTicks < 30) {
      blt(sx + 36, sy + 104, 0, 16, 72, 40, 8, 8); // press
      blt(sx + 84, sy + 104, 0, 56, 72, 40, 8, 8); // start
    }
  } else {
    section(SEC_MENU_PANEL);
    blt(sx + 24, sy + 84, 0, 0, 144, 116, 52, 8); // panel bg

    blt(sx + 40, sy + 88, 0, 56, 72, 40, 8, 8); // start
    blt(sx + 88, sy + 88, 0, 40, 80, 32, 8, 8); // game

    blt(sx + 52, sy + 104, 0, 104, 80, 56, 8, 8); // palette

    blt(sx + 44, sy + 120, 0, 96, 72, 32, 8, 8); // exit
    blt(sx + 84, sy + 120, 0, 40, 80, 32, 8, 8); // game

    const sel = menuSelIndex * 4;
    blt(sx + SELECTIONS[sel] - 12, sy + SELECTIONS[sel + 1], 0, 16, 33, 9, 9, 8); // selection ball left
    blt(sx + SELECTIONS[sel] + SELECTIONS[sel + 2] + 2, sy + SELECTIONS[sel + 1], 0, 16, 33, 9, 9, 8); // selection ball right
  }

  section(SEC_MENU_TITLE);
  blt(sx + 44, sy + 20, 0, 16, 80, 24, 8, 8); // hi-
  drawNumberShadowed(sx + 68, sy + 20, gHighscore, 6); // highscore number
  blt(sx + 13, sy + 36, 0, 16, 88, 135, 44, 8); // logo
}

// ---- game.py -----------------------------------------------------------------

let palIndex = 0;

function gameInit(): void {
  palControlInit();

  screenShakeInit();

  mainMenuInit();
  stageInit(0);

  palIndex = 0;

  playMusic(MUS_TITLE, true);
}

function gameRestartMusic(): void {
  if (menuIsVisible) playMusic(MUS_TITLE);
  else stageRestartMusic();
}

function quitToMainMenu(): void {
  stageInit(0);
  setHighScore();
  globalsReset();
  mainMenuReset();
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_3);
}

function goToNextStage(): void {
  gStageNum += 1;
  stageInit(gStageNum);
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_3);
}

function goToGameCompleteStage(): void {
  stageInit(MAX_STAGE_NUM + 1);
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_3);
}

function restartStage(): void {
  stageInit(gStageNum);
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_3);
}

function startGame(): void {
  mainMenuHide();
  stageInit(gStageNum);
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_3);
}

function gameAddScreenShake(ticks: i32, magnitude: i32, queue: boolean = false): void {
  shakeAddEvent(ticks, magnitude, queue);
}

function cyclePalette(): void {
  palIndex += 1;
  if (palIndex === NUM_PALETTES) palIndex = 0;
  addPaletteEvent(1, palIndex);
  gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_3);
}

function gameAddFade(ticksPerLevel: i32, targetLevel: i32, callback: i32 = CB_NONE): void {
  addFadeEvent(ticksPerLevel, targetLevel, callback);
}

/** Calls the method a fade or palette event names. */
function runCallback(callback: i32): void {
  if (callback === CB_START_GAME) startGame();
  else if (callback === CB_CYCLE_PALETTE) cyclePalette();
  else if (callback === CB_QUIT) {
    // pyxel.quit(): a cartridge cannot quit, so the menu fades back in.
    system.quit();
    gameAddFade(FADE_STEP_TICKS_DEFAULT, FADE_LEVEL_3);
  } else if (callback === CB_RESTART_STAGE) restartStage();
  else if (callback === CB_GO_TO_NEXT_STAGE) goToNextStage();
  else if (callback === CB_GO_TO_GAME_COMPLETE_STAGE) goToGameCompleteStage();
  else if (callback === CB_QUIT_TO_MAIN_MENU) quitToMainMenu();
  else if (callback === CB_STAGE_GO_TO_NEXT_STAGE) stageGoToNextStage();
}

function gameUpdate(): void {
  if (input.btnp(input.key.F1)) toggleSound();

  if (input.btnp(input.key.F2)) toggleMusic();

  mainMenuUpdate();

  stageUpdate();

  palControlUpdate();
  screenShakeUpdate();
}

// The display colors of Pyxel's palette, which gameDraw() maps.
let baseColors: i32[] = [];

function gameDraw(): void {
  // The original maps the four colors with pyxel.pal(DEFAULT[c], get_col(c))
  // while it draws, then resets them with pyxel.pal(). Every frame draws the
  // whole screen through these mappings, so showing each DEFAULT color in
  // the display color of get_col(c) gives the same picture, without mapping
  // pixel by pixel: the mapped blits cost several frames' worth of cycles.
  for (let c = 0; c < NUM_COLOURS; c++) {
    const shown = getCol(c);
    screen.setColor(ALL[DEFAULT * NUM_COLOURS + c], baseColors[shown]);
  }

  makePictures();

  section(SEC_CLS);
  cls(getCol(0));

  stageDraw(shakeX, shakeY);
  hudDraw(shakeX, shakeY);

  mainMenuDraw(shakeX, shakeY);

  render();
}

// ---- Drawing -----------------------------------------------------------------

// The original draws the whole screen every frame. On the GBA that takes
// about three frames: the stage alone is 270 tiles, and the SDK's loops run
// from ROM, as retro.json gives IWRAM to the 160 x 144 screen. Pyxel keeps
// the screen from one frame to the next, so the port draws only what
// changes: blt(), bltm(), rect() and cls() below record the frame's drawing
// calls, and render() compares them with the previous frame's calls and
// draws again each rectangle where they differ, by replaying, clipped to
// it, the calls from the last one that covers it with opaque pixels. A
// screen shake scrolls the screen and draws the edges it uncovers. The
// screen ends up as a full redraw leaves it.
//
// ASSET FACTS the drawing relies on, which tests/megaball.test.ts checks in
// assets/my_resource.pyxres: no stage tile holds color 8, the color key;
// every region of image 0 the game draws holds only the colors of the
// DEFAULT palette, and color 8 where it is drawn with that key; the rows
// listed in BANDED hold no pixel of color 8; the animation frames hold only
// color 8 outside their FRAME_TRIM boxes.

const OP_NONE = 0;
const OP_RECT = 1;
const OP_BLT = 2;
const OP_BLTM = 3;

/** A drawing call and the screen rectangle it can change. */
interface Op {
  section: i32;
  kind: i32;
  x: i32;
  y: i32;
  w: i32;
  h: i32;
  src: i32;
  u: i32;
  v: i32;
  // The color key of a blit, or the color of a rectangle.
  key: i32;
  // Whether it draws every pixel of its rectangle.
  opaque: boolean;
  // The call packed in three words, compared in place of its fields (see record()).
  look: i32;
  place: i32;
  source: i32;
}

// Calls are compared in sections, in drawing order, call by call within a
// section: a section whose number of calls changes, such as the player's
// ten weapon shots, disturbs only itself. A group of calls made or not
// together, such as the blinking PRESS START, has its own section.
const SEC_CLS = 0;
const SEC_STAGE = 1;
const SEC_LIGHTS = 2;
const SEC_COMPLETE = 3;
const SEC_PLAYER = 4;
const SEC_SPINNERS = 5;
const SEC_PAUSE = 6;
const SEC_GAME_OVER = 7;
const SEC_HUD = 8;
const SEC_MENU_START = 9;
const SEC_MENU_PANEL = 10;
const SEC_MENU_TITLE = 11;

// A frame makes at most about 120 calls (stage 15 has 54 lights).
const MAX_OPS = 160;
// This frame's calls and the previous frame's, in the two halves of ops.
let ops: Op[] = [];
let opBase = 0;
let opCount = 0;
let lastCount = 0;
let currentSection = SEC_CLS;
let redrawAll = true;
// The screen shake the screen was drawn with.
let drawnShakeX = 0;
let drawnShakeY = 0;

// Rectangles to draw again, [x1, x2) x [y1, y2) on the screen, and for
// each the call of this frame that covers it with opaque pixels, or -1.
let dirtyX1: i32[] = [];
let dirtyY1: i32[] = [];
let dirtyX2: i32[] = [];
let dirtyY2: i32[] = [];
let dirtyCover: i32[] = [];
let dirtyCount = 0;
// This frame's opaque calls of at least COVER_AREA pixels, which may cover
// a dirty rectangle, in drawing order (see repaint).
let covers: i32[] = [];
let coverCount = 0;
const COVER_AREA = 256;

function initDrawing(): void {
  for (let i = 0; i < 2 * MAX_OPS; i++)
    push(ops, {
      section: 0,
      kind: OP_NONE,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      src: 0,
      u: 0,
      v: 0,
      key: 0,
      opaque: false,
      look: 0,
      place: 0,
      source: 0,
    });
}

function section(id: i32): void {
  currentSection = id;
}

/**
 * Records a call, packed in three words that render() compares in place of
 * its fields: look (kind, image, opacity, key and size), place (its
 * position) and source (u, v). Every call the game makes fits their ranges;
 * one outside them gets a look no other call has.
 */
function record(kind: i32, x: i32, y: i32, w: i32, h: i32, src: i32, u: i32, v: i32, key: i32, opaque: boolean): void {
  if (opCount >= MAX_OPS) return;
  const i = opBase + opCount;
  ops[i].section = currentSection;
  ops[i].kind = kind;
  ops[i].x = x;
  ops[i].y = y;
  ops[i].w = w;
  ops[i].h = h;
  ops[i].src = src;
  ops[i].u = u;
  ops[i].v = v;
  ops[i].key = key;
  ops[i].opaque = opaque;
  const px = x + 512,
    py = y + 512,
    k = key + 1;
  // Each part in range: negative values and values past it leave high bits.
  if ((((px | py) >> 11) | ((w | h) >> 8) | ((u | v) >> 12) | (k >> 9) | (src >> 3)) === 0) {
    ops[i].look = kind | (src << 2) | (opaque ? 32 : 0) | (k << 6) | (w << 15) | (h << 23);
    ops[i].place = px | (py << 11);
    ops[i].source = u | (v << 12);
  } else {
    unpackable--;
    ops[i].look = unpackable;
    ops[i].place = 0;
    ops[i].source = 0;
  }
  opCount++;
}

let unpackable = 0;

// The 21 x 21 animation frames of image 0 (u = 21 * frame, v = 231) are
// mostly color key: [x, y, w, h] of the part of each frame that holds other
// colors (see ASSET FACTS). The last frame holds none.
const FRAME_TRIM: i32[] = [
  6, 6, 9, 9, 6, 6, 8, 8, 7, 7, 6, 6, 8, 8, 4, 4, 9, 9, 3, 3, 9, 9, 3, 3,
  7, 7, 8, 8, 5, 5, 12, 12, 3, 3, 16, 16, 2, 2, 18, 18, 1, 1, 20, 20, 0, 0, 0, 0,
]; // prettier-ignore

/**
 * pyxel.blt: every region the game draws lies inside its image, so an
 * unkeyed blit is opaque. A keyed blit of an animation frame draws only the
 * part of it in FRAME_TRIM, which leaves the same pixels.
 */
function blt(x: i32, y: i32, img: i32, u: i32, v: i32, w: i32, h: i32, colkey: i32 = -1): void {
  if (img === 0 && v === 231 && w === 21 && h === 21 && colkey === 8) {
    const t = idiv(u, 21) * 4;
    if (u === idiv(u, 21) * 21 && t < len(FRAME_TRIM)) {
      const dx = FRAME_TRIM[t],
        dy = FRAME_TRIM[t + 1];
      record(OP_BLT, x + dx, y + dy, FRAME_TRIM[t + 2], FRAME_TRIM[t + 3], img, u + dx, v + dy, colkey, false);
      return;
    }
  }
  record(OP_BLT, x, y, w, h, img, u, v, colkey, colkey < 0);
}

/** pyxel.bltm of the stage tiles, opaque as none holds the color key (see ASSET FACTS). */
function bltm(x: i32, y: i32, tm: i32, u: i32, v: i32, w: i32, h: i32, colkey: i32): void {
  record(OP_BLTM, x, y, w, h, tm, u, v, colkey, true);
}

function rect(x: i32, y: i32, w: i32, h: i32, col: i32): void {
  record(OP_RECT, x, y, w, h, 0, 0, 0, col, true);
}

/**
 * pyxel.cls: the stage and the HUD bars cover the whole screen, shaken with
 * it, with opaque pixels as no stage tile holds the color key (see ASSET
 * FACTS). The clear color then shows only in the strips the shake uncovers,
 * which are all it draws, so a fade that changes it does not draw the
 * screen again.
 */
function cls(col: i32): void {
  if (shakeX > 0) rect(0, 0, shakeX, GAME_HEIGHT, col);
  else if (shakeX < 0) rect(GAME_WIDTH + shakeX, 0, -shakeX, GAME_HEIGHT, col);
  if (shakeY > 0) rect(0, 0, GAME_WIDTH, shakeY, col);
  else if (shakeY < 0) rect(0, GAME_HEIGHT + shakeY, GAME_WIDTH, -shakeY, col);
}

/** Keeps the place of a call that draws nothing this frame in its section. */
function drawNothing(): void {
  record(OP_NONE, 0, 0, 0, 0, 0, 0, 0, 0, false);
}

function addDirty(x: i32, y: i32, w: i32, h: i32, cover: i32 = -1): void {
  const x1 = x > 0 ? x : 0,
    y1 = y > 0 ? y : 0;
  const x2 = x + w < GAME_WIDTH ? x + w : GAME_WIDTH,
    y2 = y + h < GAME_HEIGHT ? y + h : GAME_HEIGHT;
  if (x1 >= x2 || y1 >= y2) return;
  if (dirtyCount === len(dirtyX1)) {
    push(dirtyX1, 0);
    push(dirtyY1, 0);
    push(dirtyX2, 0);
    push(dirtyY2, 0);
    push(dirtyCover, -1);
  }
  dirtyX1[dirtyCount] = x1;
  dirtyY1[dirtyCount] = y1;
  dirtyX2[dirtyCount] = x2;
  dirtyY2[dirtyCount] = y2;
  dirtyCover[dirtyCount] = cover;
  dirtyCount++;
}

/** The rectangle of call i, covered by it when i is this frame's and opaque. */
function addDirtyOp(i: i32): void {
  if (ops[i].kind === OP_NONE) return;
  const current = i >= opBase && i < opBase + opCount;
  addDirty(ops[i].x, ops[i].y, ops[i].w, ops[i].h, current && ops[i].opaque ? i : -1);
}

/**
 * Merges rectangles that overlap or touch into their bounding boxes, when
 * the box adds little area: the strips a shake uncovers along two edges
 * touch at a corner, but their box is the whole screen. A rectangle inside
 * another merges into it. Rectangles left overlapping are each drawn again,
 * which gives the same pixels.
 */
function mergeDirty(): void {
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < dirtyCount; a++) {
      let ax1 = dirtyX1[a],
        ay1 = dirtyY1[a],
        ax2 = dirtyX2[a],
        ay2 = dirtyY2[a];
      let b = a + 1;
      while (b < dirtyCount) {
        const bx1 = dirtyX1[b],
          bx2 = dirtyX2[b];
        if (bx1 > ax2 || ax1 > bx2) {
          b++;
          continue;
        }
        const by1 = dirtyY1[b],
          by2 = dirtyY2[b];
        if (by1 > ay2 || ay1 > by2) {
          b++;
          continue;
        }
        const x1 = ax1 < bx1 ? ax1 : bx1,
          y1 = ay1 < by1 ? ay1 : by1,
          x2 = ax2 > bx2 ? ax2 : bx2,
          y2 = ay2 > by2 ? ay2 : by2;
        const areas = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1);
        if ((x2 - x1) * (y2 - y1) > areas + (areas >> 2) + 64) {
          b++;
          continue;
        }
        // A cover of either rectangle still covers the box when it is that rectangle.
        const aSame = x1 === ax1 && y1 === ay1 && x2 === ax2 && y2 === ay2,
          bSame = x1 === bx1 && y1 === by1 && x2 === bx2 && y2 === by2;
        dirtyCover[a] = aSame ? dirtyCover[a] : bSame ? dirtyCover[b] : -1;
        ax1 = x1;
        ay1 = y1;
        ax2 = x2;
        ay2 = y2;
        dirtyX1[a] = x1;
        dirtyY1[a] = y1;
        dirtyX2[a] = x2;
        dirtyY2[a] = y2;
        dirtyCount--;
        dirtyX1[b] = dirtyX1[dirtyCount];
        dirtyY1[b] = dirtyY1[dirtyCount];
        dirtyX2[b] = dirtyX2[dirtyCount];
        dirtyY2[b] = dirtyY2[dirtyCount];
        dirtyCover[b] = dirtyCover[dirtyCount];
        merged = true;
      }
    }
  }
}

function execute(k: i32): void {
  if (ops[k].kind === OP_RECT) screen.rect(ops[k].x, ops[k].y, ops[k].w, ops[k].h, ops[k].key);
  else if (ops[k].kind === OP_BLT && ops[k].key === 8 && ops[k].src === 0 && ops[k].h >= BANDED_MIN_ROWS) bltBanded(k);
  else if (ops[k].kind === OP_BLT)
    screen.blt(ops[k].x, ops[k].y, ops[k].src, ops[k].u, ops[k].v, ops[k].w, ops[k].h, ops[k].key);
  else if (ops[k].kind === OP_BLTM)
    screen.bltm(ops[k].x, ops[k].y, ops[k].src, ops[k].u, ops[k].v, ops[k].w, ops[k].h, ops[k].key);
}

/** Draws dirty rectangle r again from this frame's calls. */
function repaint(r: i32): void {
  const x1 = dirtyX1[r],
    y1 = dirtyY1[r],
    x2 = dirtyX2[r],
    y2 = dirtyY2[r];
  // Calls before the last opaque one that covers the rectangle are hidden.
  let first = dirtyCover[r];
  if (first < 0) {
    first = opBase;
    for (let c = coverCount - 1; c >= 0; c--) {
      const k = covers[c];
      if (ops[k].x <= x1 && ops[k].y <= y1 && ops[k].x + ops[k].w >= x2 && ops[k].y + ops[k].h >= y2) {
        first = k;
        break;
      }
    }
  }
  screen.clip(x1, y1, x2 - x1, y2 - y1);
  for (let k = first; k < opBase + opCount; k++)
    if (ops[k].x < x2 && ops[k].x + ops[k].w > x1 && ops[k].y < y2 && ops[k].y + ops[k].h > y1) execute(k);
  screen.clip();
}

function render(): void {
  const last = MAX_OPS - opBase;
  // Rectangles left from frames whose display was uniform stay dirty.
  if (redrawAll) {
    addDirty(0, 0, GAME_WIDTH, GAME_HEIGHT);
    redrawAll = false;
  } else {
    // The shake moves everything: scroll the screen along, then draw the edge it uncovers.
    const dx = shakeX - drawnShakeX,
      dy = shakeY - drawnShakeY;
    if (dx !== 0 || dy !== 0) {
      screen.blt(dx, dy, image.SCREEN, 0, 0, GAME_WIDTH, GAME_HEIGHT);
      shiftDirty(dx, dy);
      for (let k = last; k < last + lastCount; k++) {
        ops[k].x += dx;
        ops[k].y += dy;
        if (ops[k].look >= 0) ops[k].place += dx + (dy << 11);
      }
      if (dx > 0) addDirty(0, 0, dx, GAME_HEIGHT);
      else if (dx < 0) addDirty(GAME_WIDTH + dx, 0, -dx, GAME_HEIGHT);
      if (dy > 0) addDirty(0, 0, GAME_WIDTH, dy);
      else if (dy < 0) addDirty(0, GAME_HEIGHT + dy, GAME_WIDTH, -dy);
    }
    // Both lists run through the sections in order.
    let i = 0,
      j = 0;
    while (i < opCount || j < lastCount) {
      const a = opBase + i,
        b = last + j;
      if (i < opCount && j < lastCount && ops[a].section === ops[b].section) {
        if (ops[a].place !== ops[b].place || ops[a].look !== ops[b].look || ops[a].source !== ops[b].source) {
          addDirtyOp(a);
          // A call that changed in place, such as an animated light, needs its rectangle once.
          if (ops[a].x !== ops[b].x || ops[a].y !== ops[b].y || ops[a].w !== ops[b].w || ops[a].h !== ops[b].h)
            addDirtyOp(b);
        }
        i++;
        j++;
      } else if (j >= lastCount || (i < opCount && ops[a].section < ops[b].section)) {
        addDirtyOp(a);
        i++;
      } else {
        addDirtyOp(b);
        j++;
      }
    }
  }
  drawnShakeX = shakeX;
  drawnShakeY = shakeY;
  mergeDirty();
  coverCount = 0;
  for (let k = opBase; k < opBase + opCount; k++)
    if (ops[k].opaque && ops[k].w * ops[k].h >= COVER_AREA) {
      if (coverCount === len(covers)) push(covers, 0);
      covers[coverCount] = k;
      coverCount++;
    }
  if (displayUniform()) {
    repaintSome();
    // The calls change places in ops with the next frame.
    for (let r = 0; r < dirtyCount; r++) dirtyCover[r] = -1;
  } else {
    for (let r = 0; r < dirtyCount; r++) repaint(r);
    dirtyCount = 0;
  }
  lastCount = opCount;
  opBase = last;
  opCount = 0;
}

/** Moves the rectangles still to draw along with a scroll of the screen. */
function shiftDirty(dx: i32, dy: i32): void {
  let r = 0;
  while (r < dirtyCount) {
    const x1 = dirtyX1[r] + dx > 0 ? dirtyX1[r] + dx : 0,
      y1 = dirtyY1[r] + dy > 0 ? dirtyY1[r] + dy : 0;
    const x2 = dirtyX2[r] + dx < GAME_WIDTH ? dirtyX2[r] + dx : GAME_WIDTH,
      y2 = dirtyY2[r] + dy < GAME_HEIGHT ? dirtyY2[r] + dy : GAME_HEIGHT;
    if (x1 < x2 && y1 < y2) {
      dirtyX1[r] = x1;
      dirtyY1[r] = y1;
      dirtyX2[r] = x2;
      dirtyY2[r] = y2;
      r++;
    } else {
      dirtyCount--;
      dirtyX1[r] = dirtyX1[dirtyCount];
      dirtyY1[r] = dirtyY1[dirtyCount];
      dirtyX2[r] = dirtyX2[dirtyCount];
      dirtyY2[r] = dirtyY2[dirtyCount];
      dirtyCover[r] = dirtyCover[dirtyCount];
    }
  }
}

// At fade levels 0 and 6 every color the game draws shows as one display
// color, so the display is uniform whatever the screen holds: the heavy
// repaints of a new stage, which starts at such a level, are then spread
// over several frames, a band of rows each, before the fade shows them.
const UNIFORM_ROWS = 32;

/** The display color palette index i shows this frame (see gameDraw). */
function shownColor(i: i32): i32 {
  for (let c = 0; c < NUM_COLOURS; c++)
    if (ALL[DEFAULT * NUM_COLOURS + c] === i) {
      const shown = getCol(c);
      return baseColors[shown];
    }
  return baseColors[i];
}

/**
 * Whether every color the game can have on the screen shows as the same
 * display color: the game draws the four colors of DEFAULT (see ASSET FACTS).
 */
function displayUniform(): boolean {
  const shown = shownColor(ALL[DEFAULT * NUM_COLOURS]);
  for (let c = 1; c < NUM_COLOURS; c++) if (shownColor(ALL[DEFAULT * NUM_COLOURS + c]) !== shown) return false;
  // The clear color, in the strips a shake uncovers.
  return shownColor(getCol(0)) === shown;
}

/** Draws at most UNIFORM_ROWS rows of the dirty rectangles; the rest stays for later frames. */
function repaintSome(): void {
  let rows = UNIFORM_ROWS;
  while (rows > 0 && dirtyCount > 0) {
    const r = dirtyCount - 1;
    if (dirtyY2[r] - dirtyY1[r] <= rows) {
      rows -= dirtyY2[r] - dirtyY1[r];
      repaint(r);
      dirtyCount--;
    } else {
      const bottom = dirtyY2[r];
      dirtyY2[r] = dirtyY1[r] + rows;
      repaint(r);
      dirtyY1[r] = dirtyY2[r];
      dirtyY2[r] = bottom;
      rows = 0;
    }
  }
}

// Keyed blits of image 0 whose middle rows hold no key pixel: the logo, the
// menu panel and the game over panel, as [u, v, w, h, first, end] with rows
// first to end - 1 free of color 8 (see ASSET FACTS). Those rows are copied
// whole, which costs less than skipping the key pixel by pixel.
const BANDED: i32[] = [16, 88, 135, 44, 8, 29, 0, 144, 116, 52, 4, 47, 0, 196, 100, 26, 4, 21];
const BANDED_MIN_ROWS = 26;

/** A keyed blit of image 0, drawn in bands if BANDED has its region. */
function bltBanded(k: i32): void {
  const x = ops[k].x,
    y = ops[k].y,
    u = ops[k].u,
    v = ops[k].v,
    w = ops[k].w,
    h = ops[k].h;
  for (let b = 0; b < len(BANDED); b += 6) {
    if (BANDED[b] !== u || BANDED[b + 1] !== v || BANDED[b + 2] !== w || BANDED[b + 3] !== h) continue;
    const first = BANDED[b + 4],
      end = BANDED[b + 5];
    screen.blt(x, y, 0, u, v, w, first, 8);
    screen.blt(x, y + first, 0, u, v + first, w, end - first);
    screen.blt(x, y + end, 0, u, v + end, w, h - end, 8);
    return;
  }
  screen.blt(x, y, 0, u, v, w, h, 8);
}

// ---- Stage pictures ----------------------------------------------------------

// Drawing a stage's 270 tiles takes more than a frame, while a blit of a
// picture of them takes a quarter of one. The stage is drawn from such a
// picture, made ahead of time a few tiles per frame: for the current stage,
// the stage its end leads to and the main menu's stage 0. Pictures go to
// image banks 1 and 2, which the game does not use, two a bank. They stand
// for the tilemap as no stage tile holds the color key (see ASSET FACTS).

const PICTURE_SLOTS = 4;
const PICTURE_TILES = WIDTH_TILES * HEIGHT_TILES;
// Tiles a frame for pictures of other stages than the current one: a row of
// 18 costs about 40,000 cycles. Such a picture takes 45 frames.
const TILES_PER_FRAME = 6;
let slotStage: i32[] = [-1, -1, -1, -1];
// The tiles made of each slot's picture, row by row.
let slotTiles: i32[] = [0, 0, 0, 0];

function slotBank(slot: i32): i32 {
  return 1 + (slot >> 1);
}

function slotY(slot: i32): i32 {
  return (slot & 1) * HEIGHT_TILES * 8;
}

/** The tilemap of stage num, as Stage.__init__ picks it. */
function stageTilemapOf(num: i32): i32 {
  return num === MAX_STAGE_NUM + 1 ? 1 : 0;
}

function stageRowOf(num: i32): i32 {
  return num === MAX_STAGE_NUM + 1 ? 0 : num * 16;
}

/** The slot holding the finished picture of stage num, or -1. */
function pictureSlot(num: i32): i32 {
  for (let s = 0; s < PICTURE_SLOTS; s++) if (slotStage[s] === num && slotTiles[s] === PICTURE_TILES) return s;
  return -1;
}

/** The stage that follows num: the game's first from the menu, the ending after the last. */
function nextStageOf(num: i32): i32 {
  if (num <= 0) return gStageNum;
  if (num >= MAX_STAGE_NUM + 1) return 0;
  return num + 1;
}

/**
 * The slot of stage num's picture, given an empty slot or else one holding
 * neither of the stages to keep if it has none yet.
 */
function claimSlot(num: i32, keep1: i32, keep2: i32): i32 {
  for (let s = 0; s < PICTURE_SLOTS; s++) if (slotStage[s] === num) return s;
  let free = -1;
  for (let s = PICTURE_SLOTS - 1; s >= 0; s--)
    if (slotStage[s] < 0 || (free < 0 && slotStage[s] !== keep1 && slotStage[s] !== keep2)) free = s;
  if (free >= 0) {
    slotStage[free] = num;
    slotTiles[free] = 0;
  }
  return free;
}

/** Draws up to `count` more tiles of the picture in slot s, within one row. */
function makePictureTiles(s: i32, count: i32): void {
  const num = slotStage[s],
    row = idiv(slotTiles[s], WIDTH_TILES);
  const col = slotTiles[s] - row * WIDTH_TILES;
  const n = count < WIDTH_TILES - col ? count : WIDTH_TILES - col;
  image.bltm(
    slotBank(s),
    col * 8,
    slotY(s) + row * 8,
    stageTilemapOf(num),
    col * 8,
    (stageRowOf(num) + row) * 8,
    n * 8,
    8,
  );
  slotTiles[s] += n;
}

/**
 * Keeps the wanted pictures and makes some tiles of the first unfinished
 * one: a row of the current stage's, which is drawn from its tiles
 * meanwhile, or TILES_PER_FRAME of another.
 */
function makePictures(): void {
  const next = nextStageOf(stageNum);
  const current = claimSlot(stageNum, 0, next);
  const menu = claimSlot(0, stageNum, next);
  const ahead = claimSlot(next, stageNum, 0);
  if (current >= 0 && slotTiles[current] < PICTURE_TILES) makePictureTiles(current, WIDTH_TILES);
  else if (menu >= 0 && slotTiles[menu] < PICTURE_TILES) makePictureTiles(menu, TILES_PER_FRAME);
  else if (ahead >= 0 && slotTiles[ahead] < PICTURE_TILES) makePictureTiles(ahead, TILES_PER_FRAME);
}

/** Makes the first pictures, stage 0 to 2, which also copies banks 1 and 2 to RAM. */
function initPictures(): void {
  for (let num = 0; num < 3; num++) {
    const s = claimSlot(num, 0, 1);
    while (slotTiles[s] < PICTURE_TILES) makePictureTiles(s, WIDTH_TILES);
  }
}

// ---- main.py -----------------------------------------------------------------

export function setup(): void {
  system.init(GAME_WIDTH, GAME_HEIGHT, GAME_FPS);
  // START pauses and A fires: keep ENTER on START only. F1 and F2 toggle
  // sound and music on the shoulder buttons.
  input.map(input.key.RETURN, input.gba.START);
  input.map(input.key.F1, input.gba.L);
  input.map(input.key.F2, input.gba.R);

  initWeaponVel();
  for (let c = 0; c < color.COUNT; c++) push(baseColors, screen.getColor(c));
  initTiles();
  initDrawing();
  // Pictures first: their image banks need 64 KiB in one piece.
  initPictures();
  initStageScans();

  // pyxel.mouse(False) has nothing to hide on the GBA.
  gameInit();
}

export function update(): void {
  inputGet();
  gameUpdate();
}

export function draw(): void {
  gameDraw();
}
