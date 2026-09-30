// Laser Jetman, ported from the Pyxel app laser-jetman.pyxapp (Adam, MIT;
// https://github.com/helpcomputer/laser-jetman), a short arcade shooter
// inspired by Defender. This file holds the modules of its src/ folder, in
// sections named after them: constants.py, utils.py, sound_data.py,
// audio.py, input.py, gfx_data.py, sprite.py, particle.py, jetpack.py,
// lava.py, starfield.py, ground.py, laser.py, laser_gun.py, jetman.py,
// beam_up.py, human.py, collectable.py, collectable_shield.py,
// enemy_bullet.py, enemy_explosion.py, player_explosion.py, enemy.py,
// en_*.py, stage_enemies.py, enemy_spawn.py, minimap.py, hud.py,
// gameplay.py, main_menu.py, game_complete.py, app.py and main.py
// (test.py and test_sounds.py are mouse-driven developer tools, not ported).
//
// On the GBA the D-pad moves (UP fires the jetpack), A fires the laser (J
// or gamepad button 1), B leaves the pause menu (K or button 2) and START
// pauses (RETURN). ESC, which quits Pyxel, has no counterpart.
//
// Numbers: the GBA has no FPU, so the game's float positions, speeds and
// heights are 20.12 fixed point (FX = 1.0), and angles are integers in 1/40
// degree units, which hold every angle step of the game exactly; sine and
// cosine interpolate a table of whole degrees. Pyxel rounds float
// coordinates when it draws (fxRound) and Python's int() truncates (fxInt).
//
// Drawing: each call into the SDK costs hundreds of cycles, so what does not
// change is drawn once into image banks and copied: the labels and the HUD
// (bank 0, see draw_label and hud.py), the ground with the lava's bottom
// rows and the minimap's ground (bank 1, see ground.py and minimap.py).
// What the original draws under the ground is drawn after it, where the
// ground leaves it visible. The pixels are those of the original.
import { system, screen, image, input, sound, math, text, color } from "retro";
import {
  f32,
  fill,
  fillRange,
  filter,
  i16,
  i32,
  idiv,
  len,
  max,
  min,
  push,
  truncate,
  u8,
  type f32 as F32,
} from "@pocketjs/framework/solid/std";

// ---- Fixed point -------------------------------------------------------------

/** 1.0 in 20.12 fixed point. */
const FX: i32 = 4096;
const FX_BITS: i32 = 12;
const HALF: i32 = 2048;
const QUARTER: i32 = 1024;
const ONE_AND_HALF: i32 = 6144;

/** Rounds v / 2^bits to an integer, halves away from zero, as Pyxel rounds float coordinates. */
function roundShift(v: i32, bits: i32): i32 {
  const half = 1 << (bits - 1);
  return v >= 0 ? (v + half) >> bits : -((-v + half) >> bits);
}

function fxRound(v: i32): i32 {
  return roundShift(v, FX_BITS);
}

/** Python's int() of v / 2^bits: truncates toward zero. */
function truncShift(v: i32, bits: i32): i32 {
  return v >= 0 ? v >> bits : -(-v >> bits);
}

/** Python's int() of a fixed-point value. */
function fxInt(v: i32): i32 {
  return truncShift(v, FX_BITS);
}

// The GBA has no divide instruction, so even a division by a constant is a
// call of 100 or more cycles: hot code divides by multiplying instead.

/** floor(a / 40) for 0 <= a < 43640. */
function div40(a: i32): i32 {
  return (a * 26215) >> 20;
}

/** idiv(a, 10) for |a| <= FX, as sines times 0.1 need. */
function div10(a: i32): i32 {
  return a >= 0 ? (a * 104858) >> 20 : -((-a * 104858) >> 20);
}

/** idiv(a, 5) for |a| <= 4 * FX, as sines times 0.8 need. */
function div5(a: i32): i32 {
  return a >= 0 ? (a * 52429) >> 18 : -((-a * 52429) >> 18);
}

/** Angles in 1/40 degree units. */
const ANGLE_UNITS: i32 = 40;
const QUARTER_TURN: i32 = 90 * ANGLE_UNITS;
const FULL_TURN: i32 = 360 * ANGLE_UNITS;

/** round(sin(d) * FX) for d = 0 to 90 degrees. */
const SIN_DEGREES: i32[] = [
  0, 71, 143, 214, 286, 357, 428, 499, 570, 641, 711, 782, 852, 921, 991, 1060, 1129, 1198, 1266, 1334, 1401, 1468,
  1534, 1600, 1666, 1731, 1796, 1860, 1923, 1986, 2048, 2110, 2171, 2231, 2290, 2349, 2408, 2465, 2522, 2578, 2633,
  2687, 2741, 2793, 2845, 2896, 2946, 2996, 3044, 3091, 3138, 3183, 3228, 3271, 3314, 3355, 3396, 3435, 3474, 3511,
  3547, 3582, 3617, 3650, 3681, 3712, 3742, 3770, 3798, 3824, 3849, 3873, 3896, 3917, 3937, 3956, 3974, 3991, 4006,
  4021, 4034, 4046, 4056, 4065, 4074, 4080, 4086, 4090, 4094, 4095, 4096,
];

/** sin of 0 to 90 degrees in 1/40 degree units, interpolated between whole degrees (within 4e-5). */
function sinQuarter(a: i32): i32 {
  const d = div40(a),
    f = a - d * ANGLE_UNITS;
  if (f === 0) return SIN_DEGREES[d];
  return SIN_DEGREES[d] + div40((SIN_DEGREES[d + 1] - SIN_DEGREES[d]) * f);
}

/** pyxel.sin of an angle in 1/40 degrees, in fixed point. */
function sinA(angle: i32): i32 {
  const a = angle >= 0 && angle < FULL_TURN ? angle : math.mod(angle, FULL_TURN);
  if (a <= QUARTER_TURN) return sinQuarter(a);
  if (a <= 2 * QUARTER_TURN) return sinQuarter(2 * QUARTER_TURN - a);
  if (a <= 3 * QUARTER_TURN) return -sinQuarter(a - 2 * QUARTER_TURN);
  return -sinQuarter(FULL_TURN - a);
}

/** sin of each whole degree from 0 to 360, in fixed point. */
let sinTable: i16[] = [];

function makeSinTable(): void {
  sinTable = fill(361, i16(0));
  for (let d = 0; d <= 360; d++) sinTable[d] = i16(sinA(d * ANGLE_UNITS));
}

/** pyxel.cos of an angle in 1/40 degrees, in fixed point. */
function cosA(angle: i32): i32 {
  const a = angle + QUARTER_TURN;
  return sinA(a >= FULL_TURN ? a - FULL_TURN : a);
}

/** An angle in 1/40 degrees kept in 0-360 degrees, as (angle + step) % 360 does. */
function wrapAngle(angle: i32): i32 {
  return angle >= FULL_TURN ? angle - FULL_TURN : angle;
}

/** 16 random bits: a span that is a power of two needs no division. */
function rnd16(): i32 {
  return math.rndi(0, 65535);
}

/** pyxel.rndf(a, b) for fixed-point bounds, in either order, in steps of 1/65536 of the span. */
function rndFx(a: i32, b: i32): i32 {
  const lo = min(a, b),
    span = max(a, b) - lo;
  return span < 32768 ? lo + ((rnd16() * span) >> 16) : lo + ((rnd16() * (span >> 8)) >> 8);
}

/**
 * pyxel.rndi(a, b) for a <= b at most 32767 apart, without the division a
 * span that is not a power of two takes.
 */
function rndiSmall(a: i32, b: i32): i32 {
  return a + ((rnd16() * (b - a + 1)) >> 16);
}

/** utils.lerp(a, b, num / den) for fixed-point a and b. */
function lerpFx(a: i32, b: i32, num: i32, den: i32): i32 {
  return a + idiv((b - a) * num, den);
}

// ---- constants.py ------------------------------------------------------------

// App states; STATE_NONE stands for None.
const STATE_NONE: i32 = -1;
const STATE_MAIN_MENU: i32 = 0;
const STATE_GAMEPLAY: i32 = 1;
const STATE_LOAD_NEXT_STAGE: i32 = 2;
const STATE_GAME_COMPLETE: i32 = 3;

const ENEMY_TYPE_REDEYE: i32 = 0;
const ENEMY_TYPE_BOMBER: i32 = 1;
const ENEMY_TYPE_LANDER: i32 = 2;
const ENEMY_TYPE_MUTANT: i32 = 3;
const ENEMY_TYPE_POD: i32 = 4;
const ENEMY_TYPE_SWARMER: i32 = 5;
const ENEMY_TYPE_MAX: i32 = 6;

// [ redeye, bomber, lander, mutant, pod, swarmer ]
const ENEMY_SCORES: i32[] = [100, 150, 200, 250, 1000, 150];
const MAX_SCORE: i32 = 999999;
const SCORE_RESCUE_HUMAN: i32 = 500;

const NUM_STAGES: i32 = 8;
const STAGE_MAX_TIME_BONUS: i32[] = [20, 25, 35, 50, 60, 70, 80, 90]; // seconds
const SCORE_TIME_BONUS: i32 = 5000;
const SCORE_100PC_RESCUE_BONUS: i32 = 10000;

// ---- utils.py ----------------------------------------------------------------
// rect_collision() is only used by test.py.

// The layout width, the ground's, is a power of two: % is a mask.

function checkOverlappingRanges(lower1: i32, width1: i32, lower2: i32, width2: i32, layoutWidth: i32): boolean {
  const l2 = (lower2 - lower1) & (layoutWidth - 1);
  return l2 <= width1 || l2 + width2 >= layoutWidth;
}

function rectCollisionCheckWrapX(
  rect1X: i32,
  rect1Y: i32,
  rect1W: i32,
  rect1H: i32,
  rect2X: i32,
  rect2Y: i32,
  rect2W: i32,
  rect2H: i32,
  layoutWidth: i32,
): boolean {
  return (
    checkOverlappingRanges(rect1X, rect1W, rect2X, rect2W, layoutWidth) &&
    rect1Y < rect2Y + rect2H &&
    rect1Y + rect1H > rect2Y
  );
}

/** The angle in degrees from (x1, y1) to (x2, y2), across the wrap of the layout if nearer. */
function getAngleWrapX(x1: i32, y1: i32, x2: i32, y2: i32, layoutWidth: i32): F32 {
  let dx = (x2 - x1) & (layoutWidth - 1);
  if (dx * 2 > layoutWidth) dx -= layoutWidth;
  return math.atan2(f32(y2 - y1), f32(dx));
}

/** A float angle in degrees in 1/40 degree units. */
function angleUnits(deg: F32): i32 {
  return math.round(deg * f32(ANGLE_UNITS));
}

/** utils.text: text with a drop shadow. */
function shadowText(x: i32, y: i32, s: string, textCol: i32 = color.WHITE): void {
  screen.text(x + 1, y + 1, s, color.BLACK);
  screen.text(x, y, s, textCol);
}

function drawLabel(x: i32, y: i32, s: string, textCol: i32 = color.WHITE, labelCol: i32 = color.DARK_BLUE): void {
  const strW = len(s) * text.FONT_WIDTH;
  screen.rect(x - 8 + 1, y + 1, strW + 16, 8, color.NAVY);
  screen.rect(x - 8, y, strW + 16, 8, labelCol);
  shadowText(x, y + 1, s, textCol);
}

function drawCentreXLabel(y: i32, s: string, textCol: i32 = color.WHITE, labelCol: i32 = color.DARK_BLUE): void {
  const x = idiv(system.width(), 2) - idiv(getStrWidth(s), 2);
  drawLabel(x, y, s, textCol, labelCol);
}

function getStrWidth(s: string): i32 {
  return len(s) * text.FONT_WIDTH;
}

// Strings cost allocations on the GBA, each time they are passed, so the
// labels the game shows are drawn once with draw_label into image bank 0,
// below the sprites and the title, and copied from there.
const LABEL_PRESS_START: i32 = 0;
const LABEL_GET_READY: i32 = 1;
const LABEL_PAUSED: i32 = 2;
const LABEL_PRESS_B: i32 = 3;
const LABEL_GAME_OVER: i32 = 4;
const LABEL_STAGE_COMPLETE: i32 = 5;
const LABEL_TIME_BONUS: i32 = 6;
const LABEL_RESCUE_BONUS: i32 = 7;
const LABEL_CONGRATULATIONS: i32 = 8;
/** "STAGE 1" to "STAGE 8". */
const LABEL_STAGE: i32 = 9;
/** The bank row of label 0; each takes 10. */
const LABEL_V: i32 = 40;
let labelWidths: i32[] = fill(17, 0);

/** draw_label into bank 0 for label i, its box's left edge at x = 0. */
function makeLabelImg(i: i32, s: string, textCol: i32, labelCol: i32): void {
  const x = 8,
    y = LABEL_V + i * 10,
    strW = len(s) * text.FONT_WIDTH;
  image.rect(0, x - 8 + 1, y + 1, strW + 16, 8, color.NAVY);
  image.rect(0, x - 8, y, strW + 16, 8, labelCol);
  image.text(0, x + 1, y + 1 + 1, s, color.BLACK);
  image.text(0, x, y + 1, s, textCol);
  labelWidths[i] = strW + 16;
}

function makeLabels(): void {
  makeLabelImg(LABEL_PRESS_START, "PRESS START", 7, color.DARK_BLUE);
  makeLabelImg(LABEL_GET_READY, "GET READY", color.WHITE, color.PURPLE);
  makeLabelImg(LABEL_PAUSED, "PAUSED", color.WHITE, color.DARK_BLUE);
  makeLabelImg(LABEL_PRESS_B, "PRESS BUTTON B TO EXIT", color.WHITE, color.DARK_BLUE);
  makeLabelImg(LABEL_GAME_OVER, "GAME OVER", color.WHITE, color.DARK_BLUE);
  makeLabelImg(LABEL_STAGE_COMPLETE, "STAGE COMPLETE", color.WHITE, color.DARK_BLUE);
  makeLabelImg(LABEL_TIME_BONUS, `TIME BONUS: ${SCORE_TIME_BONUS}`, color.WHITE, color.GREEN);
  makeLabelImg(LABEL_RESCUE_BONUS, `100% RESCUE BONUS: ${SCORE_100PC_RESCUE_BONUS}`, color.WHITE, color.GREEN);
  makeLabelImg(LABEL_CONGRATULATIONS, "CONGRATULATIONS!", 7, color.DARK_BLUE);
  for (let n = 0; n < NUM_STAGES; n++) makeLabelImg(LABEL_STAGE + n, `STAGE ${n + 1}`, color.WHITE, color.DARK_BLUE);
}

/** draw_centre_x_label of label i: its box, then the shadow's right column and bottom row. */
function drawCentreXLabelImg(y: i32, i: i32): void {
  const w = labelWidths[i],
    v = LABEL_V + i * 10;
  const x = idiv(system.width(), 2) - idiv(w - 16, 2);
  screen.blt(x - 8, y, 0, 0, v, w, 8);
  screen.blt(x - 8 + w, y + 1, 0, w, v + 1, 1, 7);
  screen.blt(x - 7, y + 8, 0, 1, v + 8, w, 1);
}

// ---- sound_data.py and audio.py ------------------------------------------------
// Sounds are numbered in the order of sound_data._data, as add_all() does.

const SND_STAGE_RESPAWN: i32 = 0;
const SND_STAGE_COMPLETE: i32 = 1;
const SND_LASER: i32 = 2;
const SND_PLAYER_EXPLOSION: i32 = 3;
const SND_RESCUE_BEAM_UP: i32 = 4;
const SND_PLAYER_LANDS: i32 = 5;
const SND_JETPACK_FIRE: i32 = 6;
const SND_ENEMY_EXPLOSION: i32 = 7;
const SND_GOT_SHIELD: i32 = 8;
const SND_ENEMY_BEAM_UP: i32 = 9;
const SND_GAME_COMPLETE_DRUMS: i32 = 10;
const SND_GAME_COMPLETE_MELODY: i32 = 11;
/** The channel of each sound. */
const SOUND_CHANNELS: i32[] = [0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 0, 1];

// note: [cdefgab] + [ #-] + [0-4] or [r]
// tone: [t]riangle [s]quare [p]ulse [n]oise
// volume: [0-7]
// effect: [n]one [s]lide [v]ibrato [f]adeout
function addAll(): void {
  // In-Game Effects Channel 0
  sound.set(SND_STAGE_RESPAWN, "c0 c1 c2 c3 c4", "n", "1 2 2 3 4", "s", 32);
  sound.set(
    SND_STAGE_COMPLETE,
    "f4e4d4c4 f3e3d3c3 f2e2d2c2 f1e1d1c1",
    "snsnsnsn snsnsnsn snsnsnsn snsnsnsn",
    "1111 2222 3333 4444",
    "svsvsvsv svsvsvsv svsvsvsv svsvsvsv",
    8,
  );
  sound.set(SND_LASER, "c4c4 c3c3 c2c2 c1c1 c0c0", "t", "22222 11111", "s", 3);
  sound.set(SND_PLAYER_EXPLOSION, "c4d4e3f3 g3a3b2c2 d2e1f1g1 a1b0c0d0", "n", "4444 3333 2222 1111", "", 12);
  sound.set(SND_RESCUE_BEAM_UP, "c4 c3 c4 c3", "t", "2", "s", 4);

  // In-Game Effects Channel 1
  sound.set(SND_PLAYER_LANDS, "c4d4e3f3", "n", "3", "", 2);
  sound.set(SND_JETPACK_FIRE, "c2", "n", "1", "", 2);

  // In-Game Effects Channel 2
  sound.set(SND_ENEMY_EXPLOSION, "c4d4e3f3 g3a3b2c2 d2e1f1g1 a1b0c0d0", "n", "4444 3333 2222 1111", "", 4);
  sound.set(SND_GOT_SHIELD, "c1c1 c2c2 c3c3 c4c4", "s", "5", "s", 3);

  // In-Game Effects Channel 3
  sound.set(SND_ENEMY_BEAM_UP, "c4 c3 c4 c3", "p", "2", "s", 32);

  // Music
  sound.set(
    SND_GAME_COMPLETE_DRUMS,
    "c2c2a#4r c2c2a#4r c2c2a#4r c2c2a#4a#4" +
      "c2c2a#4r c2c2a#4r c2c2a#4r c2c2a#4a#4" +
      "c2c2a#4r c2c2a#4r c2c2a#4r c2c2a#4a#4" +
      "c2c2a#4r c2c2a#4r a#4a#4a#4a#4 a#4a#4a#4a#4",
    "n",
    "2",
    "fffn fffn fffn ffff",
    25,
  );
  sound.set(
    SND_GAME_COMPLETE_MELODY,
    "c2c1a1b1 c1d1e1e1 f1f1g1g1 e1e1f1g1" +
      "c2c1a1b1 c1d1e1e1 f1f1g1g1 e1e1f1g1" +
      "c2c1a1b1 c1d1e1e1 f1f1g1g1 e1e1f1g1" +
      "c2c1a1b1 c1d1e1e1 f1f1g1g1 e1e1f1g1" +
      "c2ra1r c1re1r f1f1g1g1 c1c1f1g1" +
      "a2c1a1b1 a2d1e1e1 a2f1g1g1 a2b2f1g1" +
      "c2ra1r c1re1r f1f1g1g1 c1c1f1g1" +
      "a2c1a1b1 a2d1e1e1 a2f1g1g1 a2b2f1g1",
    "s",
    "6",
    "v",
    25,
  );
}

function playSound(snd: i32, looping: boolean = false): void {
  sound.play(SOUND_CHANNELS[snd], snd, looping);
}

// ---- input.py ----------------------------------------------------------------

// Constants for input
const KEY_UP = input.key.W;
const KEY_DOWN = input.key.S;
const KEY_LEFT = input.key.A;
const KEY_RIGHT = input.key.D;
const KEY_BUTTON_1 = input.key.J;
const KEY_BUTTON_2 = input.key.K;
const KEY_BUTTON_START = input.key.RETURN;

// Alternative keyboard constants using arrow keys
const KEY_ALT_UP = input.key.UP;
const KEY_ALT_DOWN = input.key.DOWN;
const KEY_ALT_LEFT = input.key.LEFT;
const KEY_ALT_RIGHT = input.key.RIGHT;

// Constants for gamepad input
const GAMEPAD_UP = input.pad.DPAD_UP;
const GAMEPAD_DOWN = input.pad.DPAD_DOWN;
const GAMEPAD_LEFT = input.pad.DPAD_LEFT;
const GAMEPAD_RIGHT = input.pad.DPAD_RIGHT;
const GAMEPAD_BUTTON_1 = input.pad.A;
const GAMEPAD_BUTTON_2 = input.pad.B;
const GAMEPAD_BUTTON_START = input.pad.START;

interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  button1: boolean;
  button2: boolean;
  buttonStart: boolean;
}

function poll(): Input {
  return {
    up: input.btn(KEY_UP) || input.btn(KEY_ALT_UP) || input.btn(GAMEPAD_UP),
    down: input.btn(KEY_DOWN) || input.btn(KEY_ALT_DOWN) || input.btn(GAMEPAD_DOWN),
    left: input.btn(KEY_LEFT) || input.btn(KEY_ALT_LEFT) || input.btn(GAMEPAD_LEFT),
    right: input.btn(KEY_RIGHT) || input.btn(KEY_ALT_RIGHT) || input.btn(GAMEPAD_RIGHT),
    button1: input.btn(KEY_BUTTON_1) || input.btn(GAMEPAD_BUTTON_1),
    button2: input.btn(KEY_BUTTON_2) || input.btn(GAMEPAD_BUTTON_2),
    buttonStart: input.btnp(KEY_BUTTON_START) || input.btnp(GAMEPAD_BUTTON_START),
  };
}

// ---- gfx_data.py -------------------------------------------------------------
// Each pyxel.Image(8, 8) of ANIMS is an 8 x 8 cell of image bank 0, on its
// top row: sprite n at (n * 8, 0). The title image of main_menu.py is below.

const JETMAN_SPRITE_IDLE: string[] = [
  "00777700",
  "77711100",
  "77711100",
  "77777700",
  "77777777",
  "00777000",
  "00700700",
  "00700700",
];

const JETMAN_SPRITE_WALK: string[] = [
  "00777700",
  "77711100",
  "77711100",
  "77777700",
  "77777777",
  "00077700",
  "00077000",
  "00077000",
];

// The ninth row of the human sprites falls outside Pyxel's 8 x 8 image; here
// it lands on row 8 of the bank, which nothing draws.
const HUMAN_1: string[] = [
  "00011000",
  "00144100",
  "001EE100",
  "071EE170",
  "00733700",
  "00033000",
  "00077000",
  "00077000",
  "00088000",
];

const HUMAN_2: string[] = [
  "00011000",
  "00144100",
  "001EE100",
  "001EE100",
  "07733770",
  "00033000",
  "00077000",
  "00077000",
  "00088000",
];

const EN_REDEYE: string[] = [
  "003AA300",
  "03318810",
  "0AA88780",
  "0AA88880",
  "03318810",
  "00333300",
  "0A0AA0A0",
  "03000030",
];

const EN_BOMBER: string[] = [
  "0000BB00",
  "000333B0",
  "15533315",
  "00113187",
  "00113188",
  "15533311",
  "00053350",
  "00005500",
];

const EN_LANDER: string[] = [
  "01111110",
  "15888851",
  "58111185",
  "51888815",
  "21877812",
  "02277220",
  "02000020",
  "0A0000A0",
];

const EN_MUTANT: string[] = [
  "0BB00BB0",
  "BBBBBBBB",
  "88B33B88",
  "78333387",
  "11311311",
  "00133100",
  "00311300",
  "00011000",
];

const EN_POD: string[] = [
  "00088000",
  "08011080",
  "00211200",
  "81172118",
  "81122118",
  "00211200",
  "08011080",
  "00088000",
];

const EN_SWARMER: string[] = [
  "00000000",
  "000EE000",
  "00EEEE00",
  "0E8EE8E0",
  "EE8EE8EE",
  "05EEEE50",
  "00555500",
  "00000000",
];

const ICON_SHIELD: string[] = [
  "00C77C00",
  "0C0000C0",
  "C066660C",
  "C070000C",
  "50777705",
  "50000705",
  "05666650",
  "00555500",
];

const TITLE_LETTER_L: string[] = [
  "00000000",
  "80000000",
  "80000000",
  "80000000",
  "80000000",
  "80000000",
  "08000000",
  "00888888",
];

const TITLE_LETTER_A: string[] = [
  "00000000",
  "00888000",
  "08000800",
  "80000080",
  "80888080",
  "80000080",
  "80000080",
  "80000080",
];

const TITLE_LETTER_S: string[] = [
  "00000000",
  "08888880",
  "80000000",
  "80000000",
  "08888800",
  "00000080",
  "00000080",
  "88888800",
];

const TITLE_LETTER_E: string[] = [
  "00000000",
  "00888880",
  "08000000",
  "80000000",
  "80888000",
  "80000000",
  "08000000",
  "00888880",
];

const TITLE_LETTER_R: string[] = [
  "00000000",
  "88888800",
  "00000080",
  "00000080",
  "08888800",
  "80000000",
  "80000800",
  "80000080",
];

const TITLE_LETTER_J: string[] = [
  "00000000",
  "00000080",
  "00000080",
  "00000080",
  "00000080",
  "00000080",
  "00000800",
  "88888000",
];

const TITLE_LETTER_T: string[] = [
  "00000000",
  "88808880",
  "00080000",
  "00080000",
  "00080000",
  "00080000",
  "00080000",
  "00080000",
];

const TITLE_LETTER_M: string[] = [
  "00000000",
  "00888000",
  "08000800",
  "80080080",
  "80080080",
  "80080080",
  "80000080",
  "80000080",
];

const TITLE_LETTER_N: string[] = [
  "00000000",
  "00888000",
  "08000800",
  "80000080",
  "80000080",
  "80000080",
  "80000080",
  "80000080",
];

// The sprites of ANIMS, by their cell in bank 0.
const IMG_JETMAN_IDLE: i32 = 0;
const IMG_JETMAN_WALK: i32 = 1;
const IMG_HUMAN_1: i32 = 2;
const IMG_HUMAN_2: i32 = 3;
const IMG_REDEYE: i32 = 4;
const IMG_BOMBER: i32 = 5;
const IMG_LANDER: i32 = 6;
const IMG_MUTANT: i32 = 7;
const IMG_ICON_SHIELD: i32 = 8;
const IMG_POD: i32 = 9;
const IMG_SWARMER: i32 = 10;
const IMG_TITLE_LETTER_L: i32 = 11;
const IMG_TITLE_LETTER_A: i32 = 12;
const IMG_TITLE_LETTER_S: i32 = 13;
const IMG_TITLE_LETTER_E: i32 = 14;
const IMG_TITLE_LETTER_R: i32 = 15;
const IMG_TITLE_LETTER_J: i32 = 16;
const IMG_TITLE_LETTER_T: i32 = 17;
const IMG_TITLE_LETTER_M: i32 = 18;
const IMG_TITLE_LETTER_N: i32 = 19;

// ANIMS["jetman_walk"] and ANIMS["human"]; the other animations have one frame.
const ANIM_JETMAN_WALK: i32[] = [IMG_JETMAN_IDLE, IMG_JETMAN_WALK];
const ANIM_HUMAN: i32[] = [IMG_HUMAN_1, IMG_HUMAN_2];

function makeAnim(img: i32, data: string[]): void {
  image.set(0, img * 8, 0, data);
}

function makeAll(): void {
  makeAnim(IMG_JETMAN_IDLE, JETMAN_SPRITE_IDLE);
  makeAnim(IMG_JETMAN_WALK, JETMAN_SPRITE_WALK);
  makeAnim(IMG_HUMAN_1, HUMAN_1);
  makeAnim(IMG_HUMAN_2, HUMAN_2);
  makeAnim(IMG_REDEYE, EN_REDEYE);
  makeAnim(IMG_BOMBER, EN_BOMBER);
  makeAnim(IMG_LANDER, EN_LANDER);
  makeAnim(IMG_MUTANT, EN_MUTANT);
  makeAnim(IMG_ICON_SHIELD, ICON_SHIELD);
  makeAnim(IMG_POD, EN_POD);
  makeAnim(IMG_SWARMER, EN_SWARMER);
  makeAnim(IMG_TITLE_LETTER_L, TITLE_LETTER_L);
  makeAnim(IMG_TITLE_LETTER_A, TITLE_LETTER_A);
  makeAnim(IMG_TITLE_LETTER_S, TITLE_LETTER_S);
  makeAnim(IMG_TITLE_LETTER_E, TITLE_LETTER_E);
  makeAnim(IMG_TITLE_LETTER_R, TITLE_LETTER_R);
  makeAnim(IMG_TITLE_LETTER_J, TITLE_LETTER_J);
  makeAnim(IMG_TITLE_LETTER_T, TITLE_LETTER_T);
  makeAnim(IMG_TITLE_LETTER_M, TITLE_LETTER_M);
  makeAnim(IMG_TITLE_LETTER_N, TITLE_LETTER_N);
}

// ---- sprite.py ---------------------------------------------------------------

const SPRITE_SIZE: i32 = 8;
const SPRITE_HALF_SIZE: i32 = 4;

/** Sprite.draw: sprite img at a fixed-point position, flipped as asked, black transparent. */
function drawSprite(x: i32, y: i32, img: i32, flipX: boolean, flipY: boolean): void {
  const w = flipX ? -SPRITE_SIZE : SPRITE_SIZE;
  const h = flipY ? -SPRITE_SIZE : SPRITE_SIZE;
  screen.blt(fxRound(x), fxRound(y), 0, img * 8, 0, w, h, color.BLACK);
}

/**
 * The screen x of an object at world x, for the draw() methods of objects on
 * the wrapping ground, which also draw one up to `size` pixels left of the
 * screen ("Fix to ensure sprites within -8 pixels left of scroll_x get
 * partially drawn").
 */
function wrapDrawX(x: i32, scroll: i32, size: i32): i32 {
  let drawX = x - (scroll & GROUND_MASK);
  if (drawX <= -size * FX || drawX > 0) drawX = (x - scroll) & GROUND_MASK;
  return drawX;
}

function isDrawXVisible(drawX: i32, size: i32): boolean {
  return drawX > -size * FX && drawX < system.width() * FX;
}

// ---- particle.py -------------------------------------------------------------

const PARTICLES_SHAPE_POINT: i32 = 0;
const PARTICLES_SHAPE_CIRCLE: i32 = 1;

/** A particle; its shape and color and size orders are its emitter's. */
interface Particle {
  x: i32;
  y: i32;
  vx: i32;
  vy: i32;
  life: i32;
  lifeMax: i32;
  /** ceil(65536 / life_max): (life * n * recip) >> 16 is floor(life * n / life_max) for n <= 7. */
  lifeRecip: i32;
  color: i32;
  size: i32;
}

interface Emitter {
  totalFrames: i32;
  x: i32;
  y: i32;
  maxParticles: i32;
  particles: Particle[];
  // Particle variables and ranges
  particlesShape: i32;
  particlesPerFrame: i32;
  particleLifeMin: i32;
  particleLifeMax: i32;
  particleVxMin: i32;
  particleVxMax: i32;
  particleVyMin: i32;
  particleVyMax: i32;
  /** As given: particles take them reversed, as emit() passes reversed(). */
  particleColorOrder: i32[];
  particleSizeOrder: i32[];
  particleXPosRange: i32;
  particleYPosRange: i32;
  // Used for single emit particles, i.e. explosion.
  singleUseParticlesUsed: i32;
  singleUseMaxParticles: i32;
  finished: boolean;
}

/** ceil(65536 / life) for the lives of particles, 1 to 80. */
let lifeRecips: i32[] = [];

function makeLifeRecips(): void {
  lifeRecips = fill(81, 0);
  for (let life = 1; life <= 80; life++) lifeRecips[life] = idiv(65536 + life - 1, life);
}

// Emitters live in one list, so functions take an index: the main menu's
// sparks, the jetpack, the lavas of the gameplay and of game complete, and
// from FIRST_EXPLOSION on the explosions of Gameplay.explosions.
const EM_MENU: i32 = 0;
const EM_JETPACK: i32 = 1;
const EM_LAVA: i32 = 2;
const EM_COMPLETE_LAVA: i32 = 3;
const FIRST_EXPLOSION: i32 = 4;
let emitters: Emitter[] = [];

/** Emitter.__init__. */
function newEmitter(x: i32, y: i32, maxParticles: i32, particleLife: i32): Emitter {
  return {
    totalFrames: 0,
    x: x,
    y: y,
    maxParticles: maxParticles,
    particles: [],
    particlesShape: PARTICLES_SHAPE_CIRCLE,
    particlesPerFrame: 1,
    particleLifeMin: particleLife,
    particleLifeMax: particleLife,
    particleVxMin: -FX,
    particleVxMax: FX,
    particleVyMin: -FX,
    particleVyMax: FX,
    particleColorOrder: [7],
    particleSizeOrder: [1],
    particleXPosRange: FX,
    particleYPosRange: FX,
    singleUseParticlesUsed: 0,
    singleUseMaxParticles: -1,
    finished: false,
  };
}

function emitterEmit(e: i32): void {
  for (let n = 0; n < emitters[e].particlesPerFrame; n++) {
    if (emitters[e].singleUseParticlesUsed === emitters[e].singleUseMaxParticles) return;

    if (len(emitters[e].particles) >= emitters[e].maxParticles) return;

    const x = emitters[e].x + rndFx(-emitters[e].particleXPosRange, emitters[e].particleXPosRange);
    const y = emitters[e].y + rndFx(-emitters[e].particleYPosRange, emitters[e].particleYPosRange);
    const vx = rndFx(emitters[e].particleVxMin, emitters[e].particleVxMax);
    const vy = rndFx(emitters[e].particleVyMin, emitters[e].particleVyMax);
    const life = rndiSmall(emitters[e].particleLifeMin, emitters[e].particleLifeMax);
    // A new particle takes the first of the reversed orders.
    push(emitters[e].particles, {
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      life: life,
      lifeMax: life,
      lifeRecip: lifeRecips[life],
      color: emitters[e].particleColorOrder[len(emitters[e].particleColorOrder) - 1],
      size: emitters[e].particleSizeOrder[len(emitters[e].particleSizeOrder) - 1],
    });

    if (emitters[e].singleUseMaxParticles > 0) emitters[e].singleUseParticlesUsed++;
  }
}

function emitterUpdate(e: i32): void {
  emitters[e].totalFrames++;
  const colors = len(emitters[e].particleColorOrder),
    sizes = len(emitters[e].particleSizeOrder);
  // Particle.update for each particle, keeping those alive in place. Each
  // is updated in a copy, stored back: a lookup of the particle for each
  // field would cost more.
  let kept = 0;
  for (let i = 0; i < len(emitters[e].particles); i++) {
    const p = emitters[e].particles[i];
    p.life--;
    if (p.life <= 0) continue;

    p.x += p.vx;
    p.y += p.vy;
    // floor((life / life_max) * len(order)) of the reversed orders
    p.size = emitters[e].particleSizeOrder[sizes - 1 - ((p.life * sizes * p.lifeRecip) >> 16)];
    p.color = emitters[e].particleColorOrder[colors - 1 - ((p.life * colors * p.lifeRecip) >> 16)];
    emitters[e].particles[kept] = p;
    kept++;
  }
  truncate(emitters[e].particles, kept);
  if (kept === 0) {
    if (emitters[e].singleUseParticlesUsed === emitters[e].singleUseMaxParticles) emitters[e].finished = true;
  }
}

function emitterDraw(e: i32): void {
  const shape = emitters[e].particlesShape;
  for (let i = 0; i < len(emitters[e].particles); i++) {
    const p = emitters[e].particles[i];
    if (p.life > 0) {
      const x = fxRound(p.x),
        y = fxRound(p.y);
      if (shape === PARTICLES_SHAPE_POINT) screen.pset(x, y, p.color);
      else if (shape === PARTICLES_SHAPE_CIRCLE) screen.circ(x, y, p.size, p.color);
    }
  }
}

// ---- jetpack.py --------------------------------------------------------------

let jetpackFiring = false;

function makeJetpack(x: i32, y: i32): Emitter {
  const e = newEmitter(x, y + 4 * FX, 50, 20);
  // Jetpack specific variables and ranges
  e.particlesPerFrame = 3;
  e.particleLifeMin = 5;
  e.particleLifeMax = 12;
  e.particleVxMin = -QUARTER; // -0.25
  e.particleVxMax = QUARTER; // 0.25
  e.particleVyMin = QUARTER; // 0.25
  e.particleVyMax = ONE_AND_HALF; // 1.5
  e.particleColorOrder = [10, 9, 8, 2, 1];
  e.particleSizeOrder = [1, 2];
  return e;
}

function jetpackReset(): void {
  emitters[EM_JETPACK].particles = [];
}

function jetpackUpdatePosition(): void {
  if (player.flipX) emitters[EM_JETPACK].x = player.x + (SPRITE_SIZE - 2) * FX;
  else emitters[EM_JETPACK].x = player.x + FX;
  emitters[EM_JETPACK].y = player.y + 4 * FX;
}

function jetpackStop(): void {
  jetpackFiring = false;
}

function jetpackFire(): void {
  emitterEmit(EM_JETPACK);
  jetpackFiring = true;
  playSound(SND_JETPACK_FIRE);
}

function jetpackUpdate(): void {
  jetpackUpdatePosition();
  emitterUpdate(EM_JETPACK);
}

// ---- lava.py -----------------------------------------------------------------
// Lava draws a wave into its own screen-sized image, then blits the image
// with black transparent: here the wave is kept as the top row of lava in
// each column, recomputed when update_img is set, and drawn directly. Over
// the ground it is drawn after it, where it is not covered (see groundDraw).

const LAVA_HEIGHT: i32 = 24;
/** The lowest and highest top rows of the wave: sin * rndf(1, 3) truncates to -2..2. */
const LAVA_LOWEST_TOP: i32 = 106; // pyxel.height - HEIGHT + 2
const LAVA_HIGHEST_TOP: i32 = 102; // pyxel.height - HEIGHT - 2

/** The wave of each lava, EM_LAVA then EM_COMPLETE_LAVA: 128 top rows, bytes to keep them small. */
let lavaWave: u8[] = fill(2 * 128, u8(0));
let lavaUpdateImg: boolean[] = [true, true];

function makeLava(x: i32, y: i32): Emitter {
  const e = newEmitter(x, y, 30, 10);
  // Jetpack specific variables and ranges
  e.particlesPerFrame = 3;
  e.particleLifeMin = 10;
  e.particleLifeMax = 20;
  e.particleVxMin = 0;
  e.particleVxMax = 0;
  e.particleVyMin = -QUARTER; // -0.25
  e.particleVyMax = -ONE_AND_HALF; // -1.5
  e.particleColorOrder = [10, 9, 8, 1];
  e.particleSizeOrder = [2, 2, 1, 1, 1];
  e.particleXPosRange = idiv(system.width() * FX, 2);
  e.particleYPosRange = 0;
  return e;
}

/** A factor of rndf(1, 3) for each column of the wave, fixed point. */
let lavaRandom: i32[] = fill(128, 0);
/** Runs of the wave's rows to draw, as first column, last column and row. */
let lavaRuns: i32[] = fill(3 * 4 * 64, 0);

/**
 * The top row of the wave in each column, `wave` onwards in lavaWave, from
 * the angle of column 0 in 1/40 degrees: the angle grows by 8 whole degrees
 * a column, so every column interpolates between whole degrees by the same
 * fraction. Columns whose ground covers the wave's rows are skipped: they are
 * not drawn, and the wave is kept only while the ground does not move.
 * Runs in IWRAM, so helpers are written out.
 * @iwram
 */
function lavaMakeWave(wave: i32, angle: i32): void {
  const w = system.width(),
    h = system.height();
  let d = (angle * 26215) >> 20; // angle / 40
  const f = angle - d * ANGLE_UNITS;
  for (let x = 0; x < w; x++) {
    if (i32(groundTops[x]) > LAVA_HIGHEST_TOP) {
      const s0 = i32(sinTable[d]);
      const delta = (i32(sinTable[d + 1]) - s0) * f;
      const sineWave = s0 + (delta >= 0 ? (delta * 26215) >> 20 : -((-delta * 26215) >> 20));
      // int(sine_wave * rndf(1, 3)), from fixed point times fixed point
      const v = sineWave * lavaRandom[x];
      lavaWave[wave + x] = u8(h - LAVA_HEIGHT + (v >= 0 ? v >> 24 : -(-v >> 24)));
    }
    d += 8;
    if (d >= 360) d -= 360;
  }
}

/**
 * Fills lavaRuns with the runs of columns of each of the wave's top rows
 * that its wave reaches and the ground does not cover; returns their count.
 * @iwram
 */
function lavaFindRuns(wave: i32): i32 {
  let runs = 0;
  for (let y = LAVA_HIGHEST_TOP; y < LAVA_LOWEST_TOP; y++) {
    // Only the columns whose ground lies below the wave's rows (groundOpen).
    for (let span = 0; span < groundOpenCount; span++) {
      let x = i32(groundOpen[span * 2]);
      const last = i32(groundOpen[span * 2 + 1]);
      while (x <= last) {
        if (i32(lavaWave[wave + x]) <= y && i32(groundTops[x]) > y) {
          const start = x;
          while (x <= last && i32(lavaWave[wave + x]) <= y && i32(groundTops[x]) > y) x++;
          lavaRuns[runs * 3] = start;
          lavaRuns[runs * 3 + 1] = x - 1;
          lavaRuns[runs * 3 + 2] = y;
          runs++;
        } else {
          x++;
        }
      }
    }
  }
  return runs;
}

/** A lava's emitter and its wave: EM_LAVA or EM_COMPLETE_LAVA. */
function newLava(e: i32, x: i32, y: i32): void {
  emitters[e] = makeLava(x, y);
  lavaUpdateImg[e - EM_LAVA] = true;
}

function lavaUpdate(e: i32): void {
  emitterUpdate(e);

  if (emitters[e].totalFrames % 20 === 0) emitterEmit(e);

  lavaUpdateImg[e - EM_LAVA] = true;
}

function lavaDraw(e: i32, scroll: i32): void {
  const w = system.width(),
    h = system.height(),
    wave = (e - EM_LAVA) * 128;
  // Draw wave
  if (lavaUpdateImg[e - EM_LAVA]) {
    const totalFrames = emitters[e].totalFrames;
    const xDir = cosA(math.mod(totalFrames, 360) * ANGLE_UNITS) * 32;
    // rndf(1, 3) for each column, drawn here, where rndi inlines: three
    // columns take 10 random bits each of one draw.
    for (let x = 0; x < w; x += 3) {
      const bits = math.rndi(0, 1073741823);
      lavaRandom[x] = FX + ((bits & 1023) << 3);
      if (x + 1 < w) lavaRandom[x + 1] = FX + (((bits >> 10) & 1023) << 3);
      if (x + 2 < w) lavaRandom[x + 2] = FX + ((bits >> 20) << 3);
    }
    // sin((x + x_dir + scroll_x) * 8): the angle repeats every 45 pixels.
    lavaMakeWave(wave, (math.mod(xDir + scroll, 45 * FX) * 5) >> 6);
    lavaUpdateImg[e - EM_LAVA] = false;
  }
  // Each column is red from the top of the wave down: the rows below every
  // top at once, which the ground's image holds during the gameplay, then
  // each row above as runs of the columns that reach it and that the ground
  // does not cover.
  if (e === EM_COMPLETE_LAVA) screen.rect(0, LAVA_LOWEST_TOP, w, h - LAVA_LOWEST_TOP, color.RED);
  // A run of one pixel, as the wave's jagged top has many, costs less as a pset().
  const runs = lavaFindRuns(wave);
  for (let r = 0; r < runs; r++) {
    const x1 = lavaRuns[r * 3],
      x2 = lavaRuns[r * 3 + 1],
      y = lavaRuns[r * 3 + 2];
    if (x1 === x2) screen.pset(x1, y, color.RED);
    else screen.line(x1, y, x2, y, color.RED);
  }

  // Draw particles
  lavaParticlesDraw(e);
}

/** Emitter.draw for the lava's particles: the parts above the ground. */
function lavaParticlesDraw(e: i32): void {
  const w = system.width();
  for (let i = 0; i < len(emitters[e].particles); i++) {
    if (emitters[e].particles[i].life <= 0) continue;
    const x = fxRound(emitters[e].particles[i].x),
      y = fxRound(emitters[e].particles[i].y),
      r = emitters[e].particles[i].size,
      col = emitters[e].particles[i].color;
    // The highest and lowest ground tops in the columns of the circle.
    const left = max(0, x - r),
      right = min(w - 1, x + r);
    let highest = system.height(),
      lowest = 0;
    for (let c = left; c <= right; c++) {
      highest = min(highest, i32(groundTops[c]));
      lowest = max(lowest, i32(groundTops[c]));
    }
    if (y + r < highest) {
      screen.circ(x, y, r, col);
    } else if (y - r < lowest) {
      // Partly covered: column by column above the ground.
      for (let c = left; c <= right; c++) {
        screen.clip(c, 0, 1, i32(groundTops[c]));
        screen.circ(x, y, r, col);
      }
      screen.clip();
    }
  }
}

// ---- starfield.py ------------------------------------------------------------

const STAR_FRAMES_MIN: i32 = 60;
const STAR_FRAMES_MAX: i32 = 180;

interface Star {
  x: i32;
  y: i32;
  col: i32;
  life: i32;
}

const MAX_STARS: i32 = 25;
// The stars of the gameplay's starfield, then those of game complete's.
const SF_GAME: i32 = 0;
const SF_COMPLETE: i32 = 1;
let stars: Star[] = [];

function starRespawn(i: i32): void {
  // The starfield's width and height are the screen's, 128: a constant span
  // of random numbers needs no division.
  stars[i].x = math.rndi(0, 127);
  stars[i].y = math.rndi(0, 127);
  stars[i].life = rndiSmall(STAR_FRAMES_MIN, STAR_FRAMES_MAX);
}

function starUpdate(i: i32): void {
  stars[i].col = math.rndi(0, color.COUNT - 1);
  stars[i].life -= 1;
  if (stars[i].life <= 0) starRespawn(i);
}

function newStarfield(sf: i32): void {
  if (len(stars) === 0) stars = fill(2 * MAX_STARS, { x: 0, y: 0, col: 0, life: 0 });
  for (let i = sf * MAX_STARS; i < (sf + 1) * MAX_STARS; i++) {
    stars[i].col = math.rndi(0, color.COUNT - 1);
    starRespawn(i);
  }
}

function starfieldUpdate(sf: i32): void {
  for (let i = sf * MAX_STARS; i < (sf + 1) * MAX_STARS; i++) starUpdate(i);
}

/**
 * Starfield draws its stars into a black screen-sized image and blits it
 * over the whole screen, shifted by (scroll_x // 4) % width and wrapped.
 * The screen was just cleared to black, so the stars are drawn directly,
 * except those that the ground and the lava's bottom rows, drawn over them
 * in the original, cover.
 */
function starfieldDraw(sf: i32, scroll: i32): void {
  const w = system.width();
  // % w: the screen is 128 pixels wide.
  const offset = (scroll >> (FX_BITS + 2)) & (w - 1);
  for (let i = sf * MAX_STARS; i < (sf + 1) * MAX_STARS; i++) {
    let x = stars[i].x - offset;
    if (x < 0) x += w;
    if (stars[i].y < min(i32(groundTops[x]), LAVA_LOWEST_TOP)) screen.pset(x, stars[i].y, stars[i].col);
  }
}

// ---- ground.py ---------------------------------------------------------------

const GROUND_WIDTH: i32 = 1024;
/** x % width for a fixed-point x is x & GROUND_MASK: GROUND_WIDTH * FX - 1. */
const GROUND_MASK: i32 = 4194303;
const GROUND_MAX_HEIGHT: i32 = 64;
const GROUND_WAVELENGTH: F32 = 0.025; // Lower values make the hills wider
const GROUND_AMPLITUDE: F32 = 0.01; // Lower values make the hills taller and valleys deeper.

/**
 * The height of the ground in each column, fixed point: the smoothed end
 * holds fractions. The stage's ground is surfaces[surfaceCur]; the next
 * stage's is made in the other, and the two swap, as copying costs time.
 */
let surfaces: i32[][] = [[], []];
let surfaceCur = 0;
/**
 * The screen row of the top of each column of both surfaces, surface n's
 * at n * GROUND_WIDTH: max(round(height of the screen - height), its
 * height - GROUND_MAX_HEIGHT), which drawing reads every frame.
 */
let surfaceTops: u8[] = [];

/** Sets the top of column x of surface n from its height. */
function setSurfaceTop(n: i32, x: i32): void {
  const h = system.height();
  surfaceTops[n * GROUND_WIDTH + x] = u8(max(fxRound(h * FX - surfaces[n][x]), h - GROUND_MAX_HEIGHT));
}

// Ground.generate_surface takes 1024 noise values, several frames of work
// on the GBA. The next stage's ground is made a little each frame ahead of
// it: its heights, then its minimap and its first screen (see groundDraw).
// The first stage's is made during the main menu, which takes 205 frames to
// accept START, 8 columns a frame; the next stage's from GET READY on, a
// column a frame of play, and during STAGE COMPLETE (180 frames), 8 a frame,
// if it is not done yet. Its noise is seeded when it starts rather than when
// the stage starts.
const GROUND_COLUMNS_PER_FRAME: i32 = 8;

/** The columns of the next surface made so far, or -1 before it starts. */
let nextSurfaceColumns: i32 = -1;

function startNextSurface(): void {
  math.nseed(math.rndi(0, system.frameCount()));
  surfaces[1 - surfaceCur] = fill(GROUND_WIDTH, 0);
  if (len(surfaceTops) === 0) surfaceTops = fill(2 * GROUND_WIDTH, u8(0));
  nextSurfaceColumns = 0;
  nextMinimapColumns = 0;
  nextRingColumns = 0;
}

/** Ground.generate_surface, `count` columns at a time. */
function generateSurface(count: i32): void {
  if (nextSurfaceColumns < 0 || nextSurfaceColumns === GROUND_WIDTH) return;
  const end = min(GROUND_WIDTH, nextSurfaceColumns + count),
    next = 1 - surfaceCur;
  for (let x = nextSurfaceColumns; x < end; x++) {
    let noiseValue = math.noise(f32(x) * GROUND_WAVELENGTH, f32(x) * GROUND_AMPLITUDE);

    // Transform the range to [0.0, 1.0], from [-1.0, 1.0]
    noiseValue = noiseValue + f32(1);
    noiseValue = noiseValue / f32(2);

    surfaces[next][x] = math.int(f32(GROUND_MAX_HEIGHT) * noiseValue) * FX;
    setSurfaceTop(next, x);
  }
  nextSurfaceColumns = end;
  if (end < GROUND_WIDTH) return;

  // Smooth out the last 20 values back to the beginning height.
  for (let i = 1; i < 21; i++) {
    surfaces[next][GROUND_WIDTH - i] = lerpFx(surfaces[next][0], surfaces[next][GROUND_WIDTH - i], i, 20);
    setSurfaceTop(next, GROUND_WIDTH - i);
  }
}

/** Makes `columns` columns of the next stage's ground: heights, then minimap (twice as many), then its first screen (half as many). */
function prepareNextGround(columns: i32): void {
  if (nextSurfaceColumns < 0) return;
  if (nextSurfaceColumns < GROUND_WIDTH) {
    generateSurface(columns);
  } else if (nextMinimapColumns < MINIMAP_WIDTH) {
    makeMinimapColumns(2 * columns);
  } else {
    for (let n = 0; n < max(1, columns >> 1) && nextRingColumns < system.width(); n++) {
      drawRingColumn(nextRingV, nextRingColumns, true);
      nextRingColumns++;
    }
  }
}

/** Ground(): the next ground, finished now if it is not yet. */
function newGround(): void {
  if (nextSurfaceColumns < 0) startNextSurface();
  generateSurface(GROUND_WIDTH);
  makeMinimapColumns(MINIMAP_WIDTH);
  while (nextRingColumns < system.width()) {
    drawRingColumn(nextRingV, nextRingColumns, true);
    nextRingColumns++;
  }
  surfaceCur = 1 - surfaceCur;
  nextSurfaceColumns = -1;
  // The next ring and minimap become the stage's; the stage's are free for the next.
  const v = ringV;
  ringV = nextRingV;
  nextRingV = v;
  ringLo = 0;
  ringHi = nextRingColumns;
  const m = minimapV;
  minimapV = nextMinimapV;
  nextMinimapV = m;
}

/** The ground height at integer x, fixed point. */
function getHeightAt(x: i32): i32 {
  // x % width: the width is a power of two.
  return surfaces[surfaceCur][x & (GROUND_WIDTH - 1)];
}

// Ground.draw draws a navy line up from the bottom of the screen in each
// column, over the lava, whose rows from LAVA_LOWEST_TOP down are red in
// every column. A hundred lines a frame cost too much, so the ground and
// those rows are kept as an image in bank 1: a ring of 256 columns of the
// bottom GROUND_MAX_HEIGHT rows of the screen, where ground column x lives
// at x % 256 and is drawn when the scroll first shows it. The screen's rows
// are copied from it before anything else is drawn; the stars and the
// lava's wave and particles, drawn under the ground in the original, are
// then drawn only where it leaves them visible. There are two rings, the
// second for the first screen of the next stage.
const RING_WIDTH: i32 = 256;

/** The bank row of the stage's ring and of the next stage's. */
let ringV = 0;
let nextRingV = GROUND_MAX_HEIGHT;
/** The ground columns in the ring, from ringLo to ringHi - 1, unwrapped. */
let ringLo = 0;
let ringHi = 0;
/** The columns of the next stage's first screen drawn so far. */
let nextRingColumns = 0;

/** Draws ground column x, of the stage or the next stage, into the ring at bank row v. */
function drawRingColumn(v: i32, x: i32, next: boolean): void {
  const h = system.height(),
    top0 = h - GROUND_MAX_HEIGHT;
  const top = i32(surfaceTops[(next ? 1 - surfaceCur : surfaceCur) * GROUND_WIDTH + (x & (GROUND_WIDTH - 1))]);
  const u = x & (RING_WIDTH - 1),
    row = v - top0;
  const sky = min(top, LAVA_LOWEST_TOP);
  if (sky > top0) image.line(1, u, row + top0, u, row + sky - 1, color.BLACK);
  if (top > LAVA_LOWEST_TOP) image.line(1, u, row + LAVA_LOWEST_TOP, u, row + top - 1, color.RED);
  if (top < h) image.line(1, u, row + top, u, row + h - 1, color.NAVY);
}

/** Makes the ring hold ground columns x to x + width - 1. */
function groundRingShow(x: i32): void {
  const w = system.width();
  if (x + w <= ringLo || x >= ringHi) {
    ringLo = x;
    ringHi = x;
  }
  while (ringLo > x) {
    ringLo--;
    drawRingColumn(ringV, ringLo, false);
    if (ringHi - ringLo > RING_WIDTH) ringHi--;
  }
  while (ringHi < x + w) {
    drawRingColumn(ringV, ringHi, false);
    ringHi++;
    if (ringHi - ringLo > RING_WIDTH) ringLo++;
  }
}

/** The top row of the ground line in each screen column, or the screen height where there is none. */
let groundTops: u8[] = fill(128, u8(128));
/** The highest and lowest tops in each half of the screen, left then right. */
let groundHalfHighest: i32[] = [128, 128];
let groundHalfLowest: i32[] = [128, 128];
/** Spans of columns, first and last, whose ground lies below LAVA_HIGHEST_TOP. */
let groundOpen: u8[] = fill(128, u8(0));
let groundOpenCount = 0;

/**
 * groundTops and the values made from them, for the ground under scroll x.
 * Runs in IWRAM, so helpers are written out.
 * @iwram
 */
function groundUpdateTops(scroll: i32): void {
  const w = system.width(),
    h = system.height(),
    scrollInt = scroll >= 0 ? scroll >> FX_BITS : -(-scroll >> FX_BITS),
    surface = surfaceCur * GROUND_WIDTH;
  groundOpenCount = 0;
  let open = -1;
  for (let half = 0; half < 2; half++) {
    let highest = h,
      lowest = 0;
    for (let x = half * (w >> 1); x < (half + 1) * (w >> 1); x++) {
      const top = i32(surfaceTops[surface + ((x + scrollInt) & (GROUND_WIDTH - 1))]);
      groundTops[x] = u8(top);
      highest = min(highest, top);
      lowest = max(lowest, top);
      if (top > LAVA_HIGHEST_TOP && open < 0) open = x;
      if (top <= LAVA_HIGHEST_TOP && open >= 0) {
        groundOpen[groundOpenCount * 2] = u8(open);
        groundOpen[groundOpenCount * 2 + 1] = u8(x - 1);
        groundOpenCount++;
        open = -1;
      }
    }
    groundHalfHighest[half] = highest;
    groundHalfLowest[half] = lowest;
  }
  if (open >= 0) {
    groundOpen[groundOpenCount * 2] = u8(open);
    groundOpen[groundOpenCount * 2 + 1] = u8(w - 1);
    groundOpenCount++;
  }
}

/** No ground: the lava of game complete shows whole. */
function groundClearTops(): void {
  fillRange(groundTops, 0, system.width(), u8(system.height()));
  groundOpen[0] = u8(0);
  groundOpen[1] = u8(system.width() - 1);
  groundOpenCount = 1;
}

function groundDraw(scroll: i32): void {
  const w = system.width(),
    h = system.height(),
    scrollInt = fxInt(scroll);
  groundRingShow(scrollInt);
  // For each half of the screen, the ring's rows from the highest top, where
  // it is not black, down to the lowest, below which every column is ground.
  for (let half = 0; half < 2; half++) {
    const top = min(groundHalfHighest[half], LAVA_LOWEST_TOP),
      bottom = groundHalfLowest[half],
      end = (half + 1) * (w >> 1);
    let x = half * (w >> 1);
    while (x < end) {
      const u = (x + scrollInt) & (RING_WIDTH - 1);
      const n = min(end - x, RING_WIDTH - u);
      screen.blt(x, top, 1, u, ringV + top - (h - GROUND_MAX_HEIGHT), n, bottom - top);
      x += n;
    }
    screen.rect(half * (w >> 1), bottom, w >> 1, h - bottom, color.NAVY);
  }
}

// ---- laser.py ----------------------------------------------------------------

const LASER_SPEED: i32 = 4;
const LASER_LIFE: i32 = 30;
const START_LENGTH: i32 = 7;
const END_LENGTH: i32 = 30;

const LASER_COLORS: i32[] = [8, 9, 10, 11, 3, 2, 5, 12, 14];
const MAX_TRAILS: i32 = 4;

interface Laser {
  totalFrames: i32;
  x: i32;
  y: i32;
  dirX: i32;
  velX: i32;
  life: i32;
  length: i32;
  trails: i32;
  remove: boolean;
}

let lasers: Laser[] = [];

function newLaser(x: i32, y: i32, xDir: i32): void {
  push(lasers, {
    totalFrames: 0,
    x: x,
    y: y,
    dirX: xDir,
    velX: LASER_SPEED * xDir * FX,
    life: LASER_LIFE,
    length: START_LENGTH * FX,
    trails: 0,
    remove: false,
  });
  playSound(SND_LASER);
}

function laserHitRectCheck(i: i32, x: i32, y: i32, w: i32, h: i32): boolean {
  const laserX = lasers[i].dirX < 0 ? lasers[i].x - lasers[i].length : lasers[i].x;
  return rectCollisionCheckWrapX(laserX, lasers[i].y, lasers[i].length, FX, x, y, w, h, GROUND_WIDTH * FX);
}

function laserUpdate(i: i32): void {
  lasers[i].totalFrames++;
  lasers[i].life--;
  lasers[i].x += lasers[i].velX;
  // START_LENGTH + (END_LENGTH - START_LENGTH) * (1 - life / LIFE)
  lasers[i].length =
    START_LENGTH * FX + idiv((END_LENGTH - START_LENGTH) * FX * (LASER_LIFE - lasers[i].life), LASER_LIFE);
  lasers[i].trails = 1 + MAX_TRAILS - math.floordiv(lasers[i].life * MAX_TRAILS, LASER_LIFE);

  if (lasers[i].dirX < 0) {
    if (lasers[i].x <= scrollX) lasers[i].remove = true;
  } else {
    if (lasers[i].x >= scrollX + system.width() * FX) lasers[i].remove = true;
  }
}

function laserDraw(i: i32): void {
  const col = LASER_COLORS[idiv(lasers[i].totalFrames, 5) % len(LASER_COLORS)];
  const x = lasers[i].x,
    y = fxRound(lasers[i].y);
  screen.line(fxRound(x), y, fxRound(x + lasers[i].length * lasers[i].dirX), y, col);
  for (let t = 0; t < lasers[i].trails; t++) screen.pset(fxRound(x + t * 3 * FX * -lasers[i].dirX), y, col);
}

// ---- laser_gun.py ------------------------------------------------------------

const SHOT_DELAY: i32 = 12;
const MUZZLE_FLASH_FRAMES: i32 = 3;

let laserGunShotDelay = 0;
let laserGunMuzzleFlashFrames = 0;

function laserGunReset(): void {
  laserGunShotDelay = 0;
  laserGunMuzzleFlashFrames = 0;
}

function laserGunUpdate(): void {
  laserGunShotDelay = max(0, laserGunShotDelay - 1);
  laserGunMuzzleFlashFrames = max(0, laserGunMuzzleFlashFrames - 1);
}

function laserGunShoot(x: i32, y: i32, xDir: i32): void {
  if (laserGunShotDelay > 0) return;
  laserGunShotDelay = SHOT_DELAY;
  laserGunMuzzleFlashFrames = MUZZLE_FLASH_FRAMES;
  newLaser(x, y, xDir);
}

function laserGunDraw(x: i32, y: i32): void {
  if (laserGunMuzzleFlashFrames <= 0) return;
  screen.circ(fxRound(x), fxRound(y), laserGunMuzzleFlashFrames, color.WHITE);
}

// ---- jetman.py ---------------------------------------------------------------

const AIR_VEL_X: i32 = FX; // 1
const GROUND_VEL_X: i32 = HALF; // 0.5
const GRAVITY: i32 = QUARTER; // 0.25
const JETPACK_VEL_Y: i32 = -FX; // -1
const MAX_VEL_Y: i32 = 2 * FX; // 2
const WALK_ANIM_SPEED: i32 = 4;

const RESPAWN_INVINCIBLE_FRAMES: i32 = 120;

interface Jetman {
  x: i32;
  y: i32;
  img: i32;
  flipX: boolean;
  visible: boolean;
  totalFrames: i32;
  grounded: boolean;
  groundedHeight: i32;
  velX: i32;
  velY: i32;
  walkFrame: i32;
  walkFrameCounter: i32;
  invincibleFrames: i32;
  hasShield: boolean;
}

let player: Jetman = {
  x: 0,
  y: 0,
  img: 0,
  flipX: false,
  visible: true,
  totalFrames: 0,
  grounded: false,
  groundedHeight: 0,
  velX: 0,
  velY: 0,
  walkFrame: 0,
  walkFrameCounter: 0,
  invincibleFrames: 0,
  hasShield: false,
};

/** Jetman.__init__, with its jetpack and laser gun. */
function newJetman(): void {
  player = {
    x: 0,
    y: 42 * FX,
    img: IMG_JETMAN_IDLE,
    flipX: false,
    visible: true,
    totalFrames: 0,
    grounded: false,
    groundedHeight: 0,
    velX: 0,
    velY: 0,
    walkFrame: 0,
    walkFrameCounter: 0,
    invincibleFrames: 0,
    hasShield: false,
  };
  emitters[EM_JETPACK] = makeJetpack(player.x, player.y);
  jetpackFiring = false;
  laserGunReset();
}

function jetmanKill(): void {
  player.visible = false;
  playSound(SND_PLAYER_EXPLOSION);
}

function jetmanAddShield(): void {
  player.hasShield = true;
  playSound(SND_GOT_SHIELD);
}

function jetmanRemoveShield(): void {
  player.hasShield = false;
}

function gotCollectablesCheck(): void {
  for (let i = 0; i < len(collectables); i++) {
    if (
      rectCollisionCheckWrapX(
        player.x,
        player.y,
        SPRITE_SIZE * FX,
        SPRITE_SIZE * FX,
        collectables[i].x,
        collectables[i].y,
        SPRITE_SIZE * FX,
        SPRITE_SIZE * FX,
        GROUND_WIDTH * FX,
      )
    )
      collectableCollected(i);
  }
}

/** The id of the human the player starts to beam up, or -1. */
function rescuedHumanCheck(): i32 {
  for (let h = 0; h < len(humans); h++) {
    if (!humanCanBeBeamedUp(h)) continue;
    if (
      rectCollisionCheckWrapX(
        player.x,
        player.y,
        SPRITE_SIZE * FX,
        SPRITE_SIZE * FX,
        humans[h].x,
        humans[h].y,
        SPRITE_SIZE * FX,
        SPRITE_SIZE * FX,
        GROUND_WIDTH * FX,
      )
    ) {
      humanStartBeamUp(h, TYPE_PLAYER, 0);
      return humans[h].id;
    }
  }
  return -1;
}

function jetmanHitRectCheck(x: i32, y: i32, w: i32, h: i32): boolean {
  return rectCollisionCheckWrapX(player.x, player.y, SPRITE_SIZE * FX, SPRITE_SIZE * FX, x, y, w, h, GROUND_WIDTH * FX);
}

function jetmanGotHitCheck(): boolean {
  if (player.invincibleFrames > 0) return false;

  if (player.hasShield) {
    jetmanRemoveShield();
    player.invincibleFrames = RESPAWN_INVINCIBLE_FRAMES;
    return false;
  }

  jetmanKill();
  return true;
}

function jetmanRespawn(): void {
  player.totalFrames = 0;
  player.y = 42 * FX;
  player.visible = true;
  player.velX = 0;
  player.velY = 0;
  player.img = IMG_JETMAN_IDLE;
  centreScrollX();
  player.invincibleFrames = RESPAWN_INVINCIBLE_FRAMES;
  player.hasShield = false;
  jetpackReset();
  laserGunReset();
  playSound(SND_STAGE_RESPAWN);
}

function checkGrounded(): void {
  player.groundedHeight = getHeightAt((player.x + 4 * FX) >> FX_BITS);
  const height = system.height() * FX - player.groundedHeight;
  if (player.velY >= 0) {
    if (player.y + SPRITE_SIZE * FX >= height) {
      player.y = height - SPRITE_SIZE * FX;
      player.velY = 0;
      if (!player.grounded) playSound(SND_PLAYER_LANDS);
      player.grounded = true;
    } else {
      player.grounded = false;
    }
  } else {
    player.grounded = false;
  }
}

function jetmanUpdate(): void {
  player.totalFrames++;

  player.velY = min(MAX_VEL_Y, player.velY + GRAVITY);
  if (currentInput.up) {
    jetpackFire();
    player.velY = JETPACK_VEL_Y;
  } else {
    jetpackStop();
  }

  laserGunUpdate();
  if (currentInput.button1) {
    const x = player.flipX ? player.x - FX : player.x + SPRITE_SIZE * FX;
    laserGunShoot(x, player.y + 4 * FX, player.flipX ? -1 : 1);
  }

  let velX = 0;
  if (currentInput.left) {
    velX = -1;
    player.flipX = true;
  } else if (currentInput.right) {
    velX = 1;
    player.flipX = false;
  }

  if (player.grounded) {
    player.velX = velX * GROUND_VEL_X;
    if (velX !== 0) {
      player.walkFrameCounter++;
      if (player.walkFrameCounter >= WALK_ANIM_SPEED) {
        player.walkFrameCounter = 0;
        player.walkFrame = (player.walkFrame + 1) % len(ANIM_JETMAN_WALK);
      }
      player.img = ANIM_JETMAN_WALK[player.walkFrame];
    } else {
      player.img = IMG_JETMAN_IDLE;
    }
  } else {
    player.velX = velX * AIR_VEL_X;
    player.img = IMG_JETMAN_IDLE;
  }

  player.x += player.velX;
  player.y = max(8 * FX, player.y + player.velY);

  checkGrounded();

  gotCollectablesCheck();

  jetpackUpdate();

  if (player.invincibleFrames > 0) {
    player.invincibleFrames--;
    if (player.invincibleFrames === 0) player.visible = true;
    else if (player.totalFrames % 5 === 0) player.visible = !player.visible;
  }
}

function jetmanDraw(): void {
  if (!player.visible) return;

  emitterDraw(EM_JETPACK);
  drawSprite(player.x, player.y, player.img, player.flipX, false);
  const x = player.flipX ? player.x - FX : player.x + SPRITE_SIZE * FX;
  laserGunDraw(x, player.y + 4 * FX);

  if (player.hasShield) screen.circb(fxRound(player.x + 4 * FX), fxRound(player.y + 4 * FX), 8, 12);
}

// ---- beam_up.py --------------------------------------------------------------
// A BeamUp belongs to its human, whose fields hold it (see Human); a lander
// beaming up a human refers to that human.

const MAX_DITHER: i32 = HALF; // 0.5

const STATE_BEAM_GO_DOWN: i32 = 0;
const STATE_HUMAN_GO_UP: i32 = 1;
const STATE_BEAM_GO_UP: i32 = 2;
const STATE_MAX: i32 = 3;

const TYPE_PLAYER: i32 = 0;
const TYPE_ENEMY: i32 = 1;

const BEAM_TOTAL_FRAMES: i32[] = [60, 300];
const BEAM_COLOURS: i32[] = [12, 5, 1, 10, 8, 2];
const BEAM_MAX_WIDTH: i32[] = [12, 6];

function beamIsFinished(h: i32): boolean {
  return humans[h].beamFrames === humans[h].beamFramesPerState && humans[h].beamState === STATE_BEAM_GO_UP;
}

function beamUpdate(h: i32): void {
  if (beamIsFinished(h)) return;

  const framesPerState = humans[h].beamFramesPerState;
  humans[h].beamFrames = min(framesPerState, humans[h].beamFrames + 1);
  const frames = humans[h].beamFrames,
    maxWidth = BEAM_MAX_WIDTH[humans[h].beamType] * FX;

  if (humans[h].beamState === STATE_BEAM_GO_DOWN) {
    humans[h].beamWidth = lerpFx(0, maxWidth, frames, framesPerState);
    humans[h].beamHeight = lerpFx(0, humans[h].beamMaxHeight, frames, framesPerState);
    humans[h].beamDither = lerpFx(0, MAX_DITHER, frames, framesPerState);
  } else if (humans[h].beamState === STATE_HUMAN_GO_UP) {
    const top = humans[h].beamType === TYPE_PLAYER ? humans[h].beamY - 8 * FX : humans[h].beamY;
    humans[h].y = lerpFx(humans[h].beamBottom - 7 * FX, top, frames, framesPerState);
  } else if (humans[h].beamState === STATE_BEAM_GO_UP) {
    humans[h].beamWidth = lerpFx(maxWidth, 0, frames, framesPerState);
    humans[h].beamHeight = lerpFx(humans[h].beamMaxHeight, 0, frames, framesPerState);
    humans[h].beamDither = lerpFx(MAX_DITHER, 0, frames, framesPerState);
  }

  if (frames === framesPerState) {
    if (humans[h].beamState !== STATE_BEAM_GO_UP) {
      humans[h].beamState++;
      humans[h].beamFrames = 0;
    }
  }
}

function beamDraw(h: i32, drawX: i32): void {
  screen.dither(f32(humans[h].beamDither) * f32(0.000244140625)); // / FX

  // width // 2 and height // 3 are whole pixels.
  const width = humans[h].beamWidth,
    height = humans[h].beamHeight;
  let x = drawX + 4 * FX - (width >> (FX_BITS + 1)) * FX;
  const bandH = idiv(height, 3 * FX);
  let y = humans[h].beamY;
  for (let i = 0; i < 3; i++) {
    screen.rect(fxRound(x), fxRound(y), fxRound(width), bandH, BEAM_COLOURS[humans[h].beamType * 3 + i]);
    y += bandH * FX;
  }

  x = drawX + 4 * FX;
  screen.rect(fxRound(x - FX), fxRound(humans[h].beamY), 2, fxRound(height), 6);

  screen.dither(f32(1));
}

// ---- human.py ----------------------------------------------------------------

interface Human {
  /** Stays with the human while the list changes, for the lander beaming it up. */
  id: i32;
  x: i32;
  y: i32;
  img: i32;
  totalFrames: i32;
  /** total_frames % 15, for the animation. */
  animClock: i32;
  spawnHeight: i32;
  frame: i32;
  remove: boolean;
  /** beam_up is not None; the beam's fields follow. */
  beam: boolean;
  beamType: i32;
  beamState: i32;
  beamFramesPerState: i32;
  beamY: i32;
  beamBottom: i32;
  beamWidth: i32;
  beamHeight: i32;
  beamMaxHeight: i32;
  beamFrames: i32;
  beamDither: i32;
}

// NUM_STAGES = 8
const HUMANS_PER_STAGE: i32[] = [7, 9, 11, 13, 15, 15, 17, 19];

let humans: Human[] = [];
let nextHumanId = 0;

function newHuman(x: i32, y: i32): Human {
  const id = nextHumanId;
  nextHumanId++;
  return {
    id: id,
    x: x,
    y: y,
    img: IMG_HUMAN_1,
    totalFrames: 0,
    animClock: 0,
    spawnHeight: y,
    frame: 0,
    remove: false,
    beam: false,
    beamType: TYPE_PLAYER,
    beamState: STATE_BEAM_GO_DOWN,
    beamFramesPerState: 0,
    beamY: 0,
    beamBottom: 0,
    beamWidth: 0,
    beamHeight: 0,
    beamMaxHeight: 0,
    beamFrames: 0,
    beamDither: 0,
  };
}

/** The index of the human with this id, or -1. */
function humanIndex(id: i32): i32 {
  for (let h = 0; h < len(humans); h++) if (humans[h].id === id) return h;
  return -1;
}

function humanRemoveBeam(h: i32): void {
  humans[h].beam = false;
}

function humanCanBeBeamedUp(h: i32): boolean {
  return !humans[h].beam;
}

/** Human.start_beam_up: BeamUp(self, type, y). */
function humanStartBeamUp(h: i32, type: i32, y: i32): void {
  humans[h].beam = true;
  humans[h].beamType = type;
  humans[h].beamState = STATE_BEAM_GO_DOWN;
  humans[h].beamFramesPerState = idiv(BEAM_TOTAL_FRAMES[type], STATE_MAX);
  humans[h].beamY = y;
  humans[h].beamBottom = humans[h].y + 7 * FX;
  humans[h].beamWidth = 0;
  humans[h].beamHeight = 0;
  humans[h].beamMaxHeight = humans[h].beamBottom - y;
  humans[h].beamFrames = 0;
  humans[h].beamDither = 0;
}

function humanUpdate(h: i32): void {
  humans[h].totalFrames++;
  humans[h].animClock = humans[h].animClock === 14 ? 0 : humans[h].animClock + 1;

  if (humans[h].beam) {
    // enemy updates it's own beam.
    if (humans[h].beamType === TYPE_PLAYER) {
      if (!sound.isPlaying(0)) playSound(SND_RESCUE_BEAM_UP);
      beamUpdate(h);
      humans[h].remove = beamIsFinished(h);
    }
  } else {
    if (humans[h].animClock === 0) {
      // total_frames % 15 == 0
      humans[h].frame = humans[h].frame === 0 ? 1 : 0;
      humans[h].img = ANIM_HUMAN[humans[h].frame];
    }

    if (humans[h].y < humans[h].spawnHeight) humans[h].y += FX;
  }
}

function humanDraw(h: i32, scroll: i32): void {
  const drawX = wrapDrawX(humans[h].x, scroll, SPRITE_SIZE);
  if (!isDrawXVisible(drawX, SPRITE_SIZE)) return;

  if (humans[h].beam) beamDraw(h, drawX);

  drawSprite(drawX, humans[h].y, humans[h].img, false, false);

  screen.circb(fxRound(drawX + 4 * FX), fxRound(humans[h].y + 4 * FX), 7, 12);
}

function spawnAllHumans(): void {
  const step = idiv(GROUND_WIDTH, HUMANS_PER_STAGE[stageNum]);
  for (let x = 32; x < GROUND_WIDTH; x += step) {
    const h = getHeightAt(x);
    push(humans, newHuman((x - 4) * FX, system.height() * FX - h - 8 * FX));
  }
}

// ---- collectable.py and collectable_shield.py -------------------------------

const TYPE_SHIELD: i32 = 0;

interface Collectable {
  type: i32;
  x: i32;
  y: i32;
  img: i32;
  remove: boolean;
  angle: i32;
}

let collectables: Collectable[] = [];

/** CollectableShield(gameplay). */
function newCollectableShield(): void {
  shieldCnt++;
  push(collectables, {
    type: TYPE_SHIELD,
    x: math.rndi(0, GROUND_WIDTH - 1) * FX,
    y: (32 + rndiSmall(-8, 8)) * FX,
    img: IMG_ICON_SHIELD,
    remove: false,
    angle: 0,
  });
}

function collectableCollected(i: i32): void {
  collectables[i].remove = true;
  // CollectableShield.collected
  jetmanAddShield();
  shieldCnt--;
}

function collectableUpdate(i: i32): void {
  collectables[i].angle = (collectables[i].angle + 10) % 360;
  collectables[i].y += cosA(collectables[i].angle * ANGLE_UNITS);
}

function collectableDraw(i: i32, scroll: i32): void {
  const drawX = wrapDrawX(collectables[i].x, scroll, SPRITE_SIZE);
  if (!isDrawXVisible(drawX, SPRITE_SIZE)) return;

  screen.blt(fxRound(drawX), fxRound(collectables[i].y), 0, collectables[i].img * 8, 0, SPRITE_SIZE, SPRITE_SIZE, 0);
}

// ---- enemy_bullet.py ---------------------------------------------------------

const BULLET_SIZE: i32 = 2;
const BULLET_RADIUS: i32 = FX; // SIZE / 2

const MINE_SIZE: i32 = 4;
const MINE_RADIUS: i32 = 2;

const BULLET_MAX_LIFE: i32 = 120;

const SPEED_NONE: i32 = 0;
const SPEED_SLOW: i32 = 1;

interface EnemyBullet {
  totalFrames: i32;
  /** total_frames % 5, for the blinking. */
  blinkClock: i32;
  x: i32;
  y: i32;
  velX: i32;
  velY: i32;
  col: i32;
  life: i32;
  remove: boolean;
  isMine: boolean;
}

let enemyBullets: EnemyBullet[] = [];

function newEnemyBullet(x: i32, y: i32, speed: i32): void {
  let velX = 0,
    velY = 0;
  if (speed !== SPEED_NONE) {
    // set_velocity_to_player
    const a = angleUnits(
      getAngleWrapX(x + BULLET_RADIUS, y + BULLET_RADIUS, player.x + 4 * FX, player.y + 4 * FX, GROUND_WIDTH * FX),
    );
    velX = cosA(a) * speed;
    velY = sinA(a) * speed;
  }
  push(enemyBullets, {
    totalFrames: 0,
    blinkClock: 0,
    x: x,
    y: y,
    velX: velX,
    velY: velY,
    col: color.WHITE,
    life: BULLET_MAX_LIFE,
    remove: false,
    isMine: speed === SPEED_NONE,
  });
}

function enemyBulletUpdate(i: i32): void {
  enemyBullets[i].totalFrames++;
  enemyBullets[i].blinkClock = enemyBullets[i].blinkClock === 4 ? 0 : enemyBullets[i].blinkClock + 1;

  enemyBullets[i].life = max(0, enemyBullets[i].life - 1);
  if (enemyBullets[i].life === 0) {
    enemyBullets[i].remove = true;
    return;
  }

  if (!enemyBullets[i].isMine) {
    enemyBullets[i].x += enemyBullets[i].velX;
    enemyBullets[i].y += enemyBullets[i].velY;
  }

  if (enemyBullets[i].blinkClock === 0)
    enemyBullets[i].col = enemyBullets[i].col === color.WHITE ? color.RED : color.WHITE;
}

function enemyBulletDraw(i: i32, scroll: i32): void {
  const drawX = wrapDrawX(enemyBullets[i].x, scroll, BULLET_SIZE);
  if (!isDrawXVisible(drawX, BULLET_SIZE)) return;

  if (enemyBullets[i].isMine)
    screen.circ(
      fxRound(drawX + MINE_RADIUS * FX),
      fxRound(enemyBullets[i].y + MINE_RADIUS * FX),
      MINE_RADIUS,
      enemyBullets[i].col,
    );
  else
    screen.circ(
      fxRound(drawX + BULLET_RADIUS),
      fxRound(enemyBullets[i].y + BULLET_RADIUS),
      fxRound(BULLET_RADIUS),
      enemyBullets[i].col,
    );
}

// ---- enemy_explosion.py and player_explosion.py ------------------------------

function newEnemyExplosion(x: i32, y: i32): void {
  const e = newEmitter(x, y, 30, 30);
  // Particle variables and ranges
  e.particlesPerFrame = 3;
  e.particleLifeMin = 10;
  e.particleLifeMax = 30;
  e.particleVxMin = -FX;
  e.particleVxMax = FX;
  e.particleVyMin = -FX;
  e.particleVyMax = FX;
  e.particleColorOrder = [7, 10, 9, 8, 2, 1];
  e.particleSizeOrder = [2, 3, 2, 1, 1];
  e.particleXPosRange = 2 * FX;
  e.particleYPosRange = 2 * FX;
  // Used for single emit particles, i.e. explosion.
  e.singleUseMaxParticles = 20;
  push(emitters, e);
}

function newPlayerExplosion(): void {
  const e = newEmitter(player.x + 4 * FX, player.y + 4 * FX, 30, 30);
  // Particle variables and ranges
  e.particlesPerFrame = 3;
  e.particleLifeMin = 20;
  e.particleLifeMax = 80;
  e.particleVxMin = -FX;
  e.particleVxMax = FX;
  e.particleVyMin = -FX;
  e.particleVyMax = FX;
  e.particleColorOrder = [7, 13, 12, 5, 1];
  e.particleSizeOrder = [3, 4, 3, 2, 1, 1, 1];
  e.particleXPosRange = 3 * FX;
  e.particleYPosRange = 3 * FX;
  // Used for single emit particles, i.e. explosion.
  e.singleUseMaxParticles = 30;
  push(emitters, e);
}

/** EnemyExplosion.update and PlayerExplosion.update. */
function explosionUpdate(e: i32): void {
  emitterUpdate(e);
  emitterEmit(e);
}

// ---- enemy.py ----------------------------------------------------------------

const SPAWN_INVINCIBLE_FRAMES: i32 = 60;

interface Enemy {
  type: i32;
  x: i32;
  y: i32;
  img: i32;
  flipX: boolean;
  visible: boolean;
  totalFrames: i32;
  velX: i32;
  velY: i32;
  hp: i32;
  remove: boolean;
  score: i32;
  lastDrawX: i32;
  invincibleFrames: i32;
  /** total_frames % the enemy's shot period, kept alongside total_frames. */
  shotClock: i32;
  /**
   * How many times the enemy is in Gameplay.enemies, one after the other.
   * Mutants from landers and swarmers from pods are appended twice, once by
   * Enemy.__init__ and once by their creator, so they update twice a frame
   * and count twice.
   */
  refs: i32;
  // Redeye, bomber, lander and pod: angles in 1/40 degrees.
  angleX: i32;
  angleY: i32;
  // Lander
  state: i32;
  stateFrames: i32;
  /** The id of the human whose beam the lander holds (beam_up), or -1. */
  beamHuman: i32;
  nextBeamAttemptFrames: i32;
  // Mutant and swarmer
  nextMoveFrames: i32;
}

let enemies: Enemy[] = [];

function newEnemy(x: i32, y: i32, img: i32, type: i32): Enemy {
  return {
    type: type,
    x: x,
    y: y,
    img: img,
    flipX: false,
    visible: true,
    totalFrames: 0,
    velX: 0,
    velY: 0,
    hp: 1,
    remove: false,
    score: ENEMY_SCORES[type],
    lastDrawX: 0,
    invincibleFrames: SPAWN_INVINCIBLE_FRAMES,
    shotClock: 0,
    refs: 1,
    angleX: 0,
    angleY: 0,
    state: STATE_ROAM,
    stateFrames: 0,
    beamHuman: -1,
    nextBeamAttemptFrames: 0,
    nextMoveFrames: 0,
  };
}

/** Counts total_frames % period for enemy i: true when it comes back to 0. */
function enemyShotClock(i: i32, period: i32): boolean {
  enemies[i].shotClock++;
  if (enemies[i].shotClock < period) return false;
  enemies[i].shotClock = 0;
  return true;
}

/** The number of entries of Gameplay.enemies. */
function enemiesLen(): i32 {
  let n = 0;
  for (let i = 0; i < len(enemies); i++) n += enemies[i].refs;
  return n;
}

function enemyExplode(i: i32): void {
  let explodeX = (enemies[i].x + 4 * FX - scrollX) & GROUND_MASK;
  explodeX += scrollX;
  newEnemyExplosion(explodeX, enemies[i].y + 4 * FX);
  playSound(SND_ENEMY_EXPLOSION);
}

function enemyShootAtPlayer(i: i32, speed: i32): void {
  newEnemyBullet(enemies[i].x + SPRITE_HALF_SIZE * FX, enemies[i].y + SPRITE_HALF_SIZE * FX, speed);
}

function enemyDestroy(i: i32): void {
  if (enemies[i].type === ENEMY_TYPE_LANDER) landerDestroy(i);
  enemies[i].invincibleFrames = 0;
  enemies[i].hp = 0;
  enemies[i].visible = false;
  enemies[i].remove = true;
  enemyExplode(i);
  if (enemies[i].type === ENEMY_TYPE_POD) podDestroy(i);
}

function enemyHit(i: i32): void {
  enemies[i].hp = max(0, enemies[i].hp - 1);
  if (enemies[i].hp === 0) {
    enemyDestroy(i);
    addScore(enemies[i].score);
  }
}

function enemyGotHitCheck(i: i32): void {
  if (enemies[i].invincibleFrames > 0) return;

  for (let s = 0; s < len(lasers); s++) {
    if (laserHitRectCheck(s, enemies[i].x, enemies[i].y, SPRITE_SIZE * FX, SPRITE_SIZE * FX)) {
      lasers[s].remove = true;
      enemyHit(i);
      break;
    }
  }
}

function enemyMove(i: i32): void {
  enemies[i].x += enemies[i].velX;
  enemies[i].y += enemies[i].velY;
}

function enemyUpdateInvincibleFrames(i: i32): void {
  if (enemies[i].invincibleFrames > 0) {
    enemies[i].invincibleFrames--;
    if (enemies[i].invincibleFrames === 0) enemies[i].visible = true;
    else if (enemies[i].totalFrames % 5 === 0) enemies[i].visible = !enemies[i].visible;
  }
}

function enemyUpdate(i: i32): void {
  const type = enemies[i].type;
  if (type === ENEMY_TYPE_REDEYE) redeyeUpdate(i);
  else if (type === ENEMY_TYPE_BOMBER) bomberUpdate(i);
  else if (type === ENEMY_TYPE_LANDER) landerUpdate(i);
  else if (type === ENEMY_TYPE_MUTANT) mutantUpdate(i);
  else if (type === ENEMY_TYPE_POD) podUpdate(i);
  else swarmerUpdate(i);
}

function enemyDraw(i: i32, scroll: i32): void {
  if (enemies[i].visible) {
    enemies[i].lastDrawX = wrapDrawX(enemies[i].x, scroll, SPRITE_SIZE);
    if (isDrawXVisible(enemies[i].lastDrawX, SPRITE_SIZE))
      drawSprite(enemies[i].lastDrawX, enemies[i].y, enemies[i].img, enemies[i].flipX, false);
  }

  // EnLander.draw
  if (enemies[i].type === ENEMY_TYPE_LANDER && enemies[i].beamHuman >= 0) {
    const h = humanIndex(enemies[i].beamHuman);
    if (h >= 0) beamDraw(h, enemies[i].lastDrawX);
  }
}

// ---- en_redeye.py ------------------------------------------------------------

function newRedeye(x: i32, y: i32): void {
  const e = newEnemy(x, y, IMG_REDEYE, ENEMY_TYPE_REDEYE);
  e.angleX = rndiSmall(0, 360) * ANGLE_UNITS;
  e.angleY = rndiSmall(0, 360) * ANGLE_UNITS;
  push(enemies, e);
}

function redeyeUpdate(i: i32): void {
  enemies[i].totalFrames++;
  enemies[i].angleX = wrapAngle(enemies[i].angleX + ANGLE_UNITS);
  enemies[i].velX = sinA(enemies[i].angleX); // * 1
  enemies[i].angleY = wrapAngle(enemies[i].angleY + 6 * ANGLE_UNITS);
  enemies[i].velY = cosA(enemies[i].angleY);
  enemyMove(i);
  enemies[i].flipX = enemies[i].velX < 0;
  enemyUpdateInvincibleFrames(i);
  enemyGotHitCheck(i);
}

// ---- en_bomber.py ------------------------------------------------------------

function newBomber(x: i32, y: i32): void {
  const e = newEnemy(x, y, IMG_BOMBER, ENEMY_TYPE_BOMBER);
  e.angleX = rndiSmall(0, 360) * ANGLE_UNITS;
  e.angleY = rndiSmall(0, 360) * ANGLE_UNITS;
  push(enemies, e);
}

function bomberUpdate(i: i32): void {
  enemies[i].totalFrames++;

  if (enemyShotClock(i, 180)) enemyShootAtPlayer(i, SPEED_NONE); // total_frames % 180 == 0

  enemies[i].angleX = wrapAngle(enemies[i].angleX + 10); // 0.25
  enemies[i].velX = sinA(enemies[i].angleX);

  enemies[i].angleY = wrapAngle(enemies[i].angleY + ANGLE_UNITS);
  enemies[i].velY = div10(cosA(enemies[i].angleY)); // * 0.1

  enemyMove(i);

  enemies[i].flipX = enemies[i].velX < 0;

  enemyUpdateInvincibleFrames(i);
  enemyGotHitCheck(i);
}

// ---- en_lander.py ------------------------------------------------------------

const RESET_HEIGHT: i32 = 24;

const STATE_ROAM: i32 = 0;
const STATE_BEAM_UP: i32 = 1;

const MAX_NEXT_BEAM_ATTEMPT_FRAMES: i32 = 300;

function newLander(x: i32, y: i32): void {
  const e = newEnemy(x, y, IMG_LANDER, ENEMY_TYPE_LANDER);
  e.angleX = rndiSmall(0, 360) * ANGLE_UNITS;
  e.angleY = rndiSmall(0, 360) * ANGLE_UNITS;
  e.state = STATE_ROAM;
  e.stateFrames = 0;
  e.beamHuman = -1;
  e.nextBeamAttemptFrames = MAX_NEXT_BEAM_ATTEMPT_FRAMES;
  push(enemies, e);
}

/** EnLander.destroy, before Enemy.destroy; it keeps its beam_up. */
function landerDestroy(i: i32): void {
  if (enemies[i].beamHuman >= 0) {
    const h = humanIndex(enemies[i].beamHuman);
    if (h >= 0) humanRemoveBeam(h);
    currentAbductions--;
  }
}

function landerSwitchState(i: i32, newState: i32): void {
  enemies[i].state = newState;
  enemies[i].stateFrames = 0;
}

function isBeamingUpHuman(i: i32): boolean {
  return enemies[i].state === STATE_BEAM_UP;
}

function scannedHumanBelow(i: i32): boolean {
  for (let h = 0; h < len(humans); h++) {
    if (!humanCanBeBeamedUp(h)) continue;
    if (((enemies[i].x + 4 * FX - (humans[h].x + 4 * FX)) & GROUND_MASK) < 2 * FX) {
      humanStartBeamUp(h, TYPE_ENEMY, enemies[i].y + 8 * FX);
      enemies[i].beamHuman = humans[h].id;
      currentAbductions++;
      return true;
    }
  }
  return false;
}

function landerUpdateStateRoam(i: i32): void {
  enemies[i].nextBeamAttemptFrames = max(0, enemies[i].nextBeamAttemptFrames - 1);

  if (currentAbductions === 0 && enemies[i].nextBeamAttemptFrames === 0) {
    if (scannedHumanBelow(i)) {
      landerSwitchState(i, STATE_BEAM_UP);
      return;
    }
  }

  enemies[i].angleX = wrapAngle(enemies[i].angleX + 4); // 0.1
  enemies[i].velX = div5(sinA(enemies[i].angleX) * 4); // * 0.8

  enemies[i].angleY = wrapAngle(enemies[i].angleY + 6 * ANGLE_UNITS);
  enemies[i].velY = div10(cosA(enemies[i].angleY)); // * 0.1

  enemyMove(i);
  enemies[i].flipX = enemies[i].velX < 0;
}

function landerUpdateBeamUp(i: i32): void {
  if (enemies[i].beamHuman >= 0) {
    const h = humanIndex(enemies[i].beamHuman);
    if (h < 0) return;
    if (beamIsFinished(h)) {
      currentAbductions--;
      enemies[i].nextBeamAttemptFrames = MAX_NEXT_BEAM_ATTEMPT_FRAMES;
      newMutant(humans[h].x, humans[h].y, 2);
      mutantsCreated++;
      const id = humans[h].id;
      humans = filter(humans, (human) => human.id !== id);
      enemies[i].beamHuman = -1;
      landerSwitchState(i, STATE_ROAM);
      return;
    }
    if (!sound.isPlaying(3)) playSound(SND_ENEMY_BEAM_UP);
    beamUpdate(h);
  }
}

function landerUpdate(i: i32): void {
  enemies[i].totalFrames++;

  if (enemies[i].state === STATE_ROAM) landerUpdateStateRoam(i);
  else if (enemies[i].state === STATE_BEAM_UP) landerUpdateBeamUp(i);

  if (enemyShotClock(i, 420)) enemyShootAtPlayer(i, SPEED_SLOW); // total_frames % 420 == 0

  enemyUpdateInvincibleFrames(i);
  enemyGotHitCheck(i);
}

// ---- en_mutant.py ------------------------------------------------------------

const MUTANT_MIN_NEXT_MOVE_FRAMES: i32 = 15;
const MUTANT_ADD_NEXT_MOVE_FRAMES: i32 = 45;

/** SPEED = 0.35 */
function mutantSpeed(v: i32): i32 {
  return idiv(v * 35, 100);
}

/** EnMutant(gameplay, x, y), in the enemy list `refs` times. */
function newMutant(x: i32, y: i32, refs: i32): void {
  const e = newEnemy(x, y, IMG_MUTANT, ENEMY_TYPE_MUTANT);
  // Reduced to 0 as spawned from landers.
  e.invincibleFrames = 0;
  e.nextMoveFrames = MUTANT_MIN_NEXT_MOVE_FRAMES + rndiSmall(0, MUTANT_ADD_NEXT_MOVE_FRAMES);
  e.refs = refs;
  push(enemies, e);
}

function mutantSetNewTarget(i: i32): void {
  const a = angleUnits(
    getAngleWrapX(
      enemies[i].x + 4 * FX,
      enemies[i].y + 4 * FX,
      player.x + 4 * FX,
      player.y + 4 * FX,
      GROUND_WIDTH * FX,
    ),
  );
  enemies[i].velX = mutantSpeed(cosA(a));
  enemies[i].velY = mutantSpeed(sinA(a));
  enemies[i].nextMoveFrames = MUTANT_MIN_NEXT_MOVE_FRAMES + rndiSmall(0, MUTANT_ADD_NEXT_MOVE_FRAMES);
}

function mutantUpdate(i: i32): void {
  enemies[i].totalFrames++;

  if (enemies[i].nextMoveFrames === 0) mutantSetNewTarget(i);
  enemies[i].nextMoveFrames = max(0, enemies[i].nextMoveFrames - 1);
  enemyMove(i);
  enemyGotHitCheck(i);

  if (enemyShotClock(i, 360)) enemyShootAtPlayer(i, SPEED_SLOW); // total_frames % 360 == 0
}

// ---- en_pod.py ---------------------------------------------------------------

function newPod(x: i32, y: i32): void {
  const e = newEnemy(x, y, IMG_POD, ENEMY_TYPE_POD);
  e.angleX = rndiSmall(0, 360) * ANGLE_UNITS;
  e.angleY = rndiSmall(0, 360) * ANGLE_UNITS;
  push(enemies, e);
}

/** EnPod.destroy, after Enemy.destroy. */
function podDestroy(i: i32): void {
  const num = rndiSmall(3, 5);
  for (let n = 0; n < num; n++) {
    const x = enemies[i].x + rndiSmall(-8, 16) * FX;
    const y = enemies[i].y + rndiSmall(-8, 16) * FX;
    newSwarmer(x, y, 2);
  }
}

function podUpdate(i: i32): void {
  enemies[i].totalFrames++;

  enemies[i].angleX = wrapAngle(enemies[i].angleX + 1); // 0.025
  enemies[i].velX = idiv(sinA(enemies[i].angleX), 2); // * 0.5

  enemies[i].angleY = wrapAngle(enemies[i].angleY + ANGLE_UNITS);
  enemies[i].velY = div10(cosA(enemies[i].angleY)); // * 0.1
  enemyMove(i);
  enemyUpdateInvincibleFrames(i);
  enemyGotHitCheck(i);

  if (enemyShotClock(i, 320)) enemyShootAtPlayer(i, SPEED_SLOW); // total_frames % 320 == 0
}

// ---- en_swarmer.py -----------------------------------------------------------

const SWARMER_MIN_NEXT_MOVE_FRAMES: i32 = 35;
const SWARMER_ADD_NEXT_MOVE_FRAMES: i32 = 60;

/** SPEED = 0.375 */
function swarmerSpeed(v: i32): i32 {
  return idiv(v * 3, 8);
}

/** EnSwarmer(gameplay, x, y), in the enemy list `refs` times. */
function newSwarmer(x: i32, y: i32, refs: i32): void {
  const e = newEnemy(x, y, IMG_SWARMER, ENEMY_TYPE_SWARMER);
  // Reduced to 0 as spawned from pods.
  e.invincibleFrames = 0;
  e.nextMoveFrames = SWARMER_MIN_NEXT_MOVE_FRAMES + rndiSmall(0, SWARMER_ADD_NEXT_MOVE_FRAMES);
  e.refs = refs;
  push(enemies, e);
}

function swarmerSetNewTarget(i: i32): void {
  const a = angleUnits(
    getAngleWrapX(
      enemies[i].x + 4 * FX,
      enemies[i].y + 4 * FX,
      player.x + (4 + rndiSmall(-8, 8)) * FX,
      player.y + (4 + rndiSmall(-8, 8)) * FX,
      GROUND_WIDTH * FX,
    ),
  );
  enemies[i].velX = swarmerSpeed(cosA(a));
  enemies[i].velY = swarmerSpeed(sinA(a));
  enemies[i].nextMoveFrames = SWARMER_MIN_NEXT_MOVE_FRAMES + rndiSmall(0, SWARMER_ADD_NEXT_MOVE_FRAMES);
}

function swarmerUpdate(i: i32): void {
  enemies[i].totalFrames++;
  if (enemies[i].nextMoveFrames === 0) swarmerSetNewTarget(i);
  enemies[i].nextMoveFrames = max(0, enemies[i].nextMoveFrames - 1);
  enemyMove(i);
  enemyGotHitCheck(i);
}

// ---- stage_enemies.py --------------------------------------------------------

// Note: Mutants and Swarmers are created by other
// enemies and do not need to be created at a spawn.
// They are part of this list for completeness.

// [ redeye, bomber, lander, mutant, pod, swarmer ] for each stage
const SPAWNS: i32[] = [
  8,
  0,
  0,
  0,
  0,
  0, // STAGE 1
  4,
  4,
  0,
  0,
  0,
  0, // STAGE 2
  0,
  4,
  4,
  0,
  0,
  0, // STAGE 3
  3,
  2,
  3,
  0,
  0,
  0, // STAGE 4
  0,
  0,
  4,
  0,
  4,
  0, // STAGE 5
  2,
  0,
  3,
  0,
  3,
  0, // STAGE 6
  2,
  2,
  2,
  0,
  2,
  0, // STAGE 7
  2,
  2,
  2,
  0,
  2,
  0, // STAGE 8
];

// [ redeye, bomber, lander, mutant, pod, swarmer ] for each stage
const MAX_PER_SPAWN: i32[] = [
  16,
  0,
  0,
  0,
  0,
  0, // STAGE 1
  10,
  10,
  0,
  0,
  0,
  0, // STAGE 2
  0,
  12,
  12,
  0,
  0,
  0, // STAGE 3
  10,
  0,
  10,
  0,
  8,
  0, // STAGE 4
  0,
  0,
  16,
  0,
  16,
  0, // STAGE 5
  14,
  0,
  12,
  0,
  12,
  0, // STAGE 6
  12,
  10,
  10,
  0,
  10,
  0, // STAGE 7
  12,
  11,
  12,
  0,
  11,
  0, // STAGE 8
];

const MAX_ACTIVE_ENEMIES: i32[] = [8, 10, 10, 12, 14, 16, 18, 20];

// ---- enemy_spawn.py ----------------------------------------------------------

const MIN_NEXT_SPAWN_FRAMES: i32 = 120;
const MAX_ADD_NEXT_SPAWN_FRAMES: i32 = 180;

const SPAWN_ANIM_FRAMES: i32 = 45;

const SPAWN_RADIUS: i32 = 8;
const SPAWN_COL: i32[] = [7, 6, 5, 1, 0];

interface EnemySpawn {
  x: i32;
  y: i32;
  enemyType: i32; // only need one spawn per enemy type.
  spawnMax: i32;
  spawnedCnt: i32;
  nextSpawnFrames: i32;
  justSpawnedFrames: i32;
}

let enemySpawns: EnemySpawn[] = [];

function newEnemySpawn(x: i32, y: i32, enemyType: i32, spawnMax: i32): void {
  push(enemySpawns, {
    x: x,
    y: y,
    enemyType: enemyType,
    spawnMax: spawnMax,
    spawnedCnt: 0,
    nextSpawnFrames: rndiSmall(0, MIN_NEXT_SPAWN_FRAMES),
    justSpawnedFrames: 0,
  });
}

function enemySpawnSpawnNext(i: i32): void {
  enemySpawns[i].nextSpawnFrames = MIN_NEXT_SPAWN_FRAMES + rndiSmall(0, MAX_ADD_NEXT_SPAWN_FRAMES);
  enemySpawns[i].justSpawnedFrames = SPAWN_ANIM_FRAMES;
  const type = enemySpawns[i].enemyType,
    x = enemySpawns[i].x,
    y = enemySpawns[i].y;
  if (type === ENEMY_TYPE_REDEYE) newRedeye(x, y);
  else if (type === ENEMY_TYPE_BOMBER) newBomber(x, y);
  else if (type === ENEMY_TYPE_LANDER) newLander(x, y);
  else if (type === ENEMY_TYPE_MUTANT) newMutant(x, y, 1);
  else if (type === ENEMY_TYPE_POD) newPod(x, y);
  else if (type === ENEMY_TYPE_SWARMER) newSwarmer(x, y, 1);
  enemySpawns[i].spawnedCnt++;
}

function enemySpawnUpdate(i: i32): void {
  if (enemySpawns[i].nextSpawnFrames === 0) {
    if (enemySpawns[i].spawnedCnt < enemySpawns[i].spawnMax) {
      if (enemiesLen() < MAX_ACTIVE_ENEMIES[stageNum]) enemySpawnSpawnNext(i);
    }
  }

  enemySpawns[i].nextSpawnFrames = max(0, enemySpawns[i].nextSpawnFrames - 1);
  enemySpawns[i].justSpawnedFrames = max(0, enemySpawns[i].justSpawnedFrames - 1);
}

function enemySpawnDraw(i: i32, scroll: i32): void {
  const just = enemySpawns[i].justSpawnedFrames;
  if (just <= 0) return;

  const drawX = wrapDrawX(enemySpawns[i].x, scroll, 8);
  if (!isDrawXVisible(drawX, 8)) return;

  // progress = 1 - just / SPAWN_ANIM_FRAMES; r = lerp(SPAWN_RADIUS, 0, progress)
  const r = idiv(2 * SPAWN_RADIUS * just + SPAWN_ANIM_FRAMES, 2 * SPAWN_ANIM_FRAMES);
  // floor(lerp(0, len(COL) - 1, progress))
  const top = len(SPAWN_COL) - 1;
  const col = top - idiv(top * just + SPAWN_ANIM_FRAMES - 1, SPAWN_ANIM_FRAMES);
  screen.circ(fxRound(drawX), fxRound(enemySpawns[i].y), r, SPAWN_COL[col]);
}

// [ redeye, bomber, lander, mutant, pod, swarmer ]
const SPAWN_MIN_Y: i32[] = [40, 40, RESET_HEIGHT, 40, 40, 40];
const SPAWN_ADD_RANDOM_Y: i32[] = [16, 16, 0, 16, 16, 16];

/** random.shuffle */
function shuffle(values: i32[]): i32[] {
  const out = values;
  for (let i = len(out) - 1; i > 0; i--) {
    const j = rndiSmall(0, i);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

function createAllSpawns(): void {
  let spawnTypesNeeded: i32[] = [];
  for (let t = 0; t < ENEMY_TYPE_MAX; t++) {
    const qty = SPAWNS[stageNum * ENEMY_TYPE_MAX + t];
    for (let n = 0; n < qty; n++) push(spawnTypesNeeded, t);
  }
  spawnTypesNeeded = shuffle(spawnTypesNeeded);

  const stepWidth = idiv(GROUND_WIDTH, len(spawnTypesNeeded));
  let x = rndiSmall(0, 128);
  let spawnX: i32[] = [];
  for (let n = 0; n < len(spawnTypesNeeded); n++) {
    push(spawnX, x);
    x += stepWidth;
    if (stepWidth >= GROUND_WIDTH) x -= GROUND_WIDTH;
  }
  spawnX = shuffle(spawnX);

  for (let i = 0; i < len(spawnTypesNeeded); i++) {
    const t = spawnTypesNeeded[i];
    newEnemySpawn(
      spawnX[i] * FX,
      (SPAWN_MIN_Y[t] + rndiSmall(-SPAWN_ADD_RANDOM_Y[t], SPAWN_ADD_RANDOM_Y[t])) * FX,
      t,
      MAX_PER_SPAWN[stageNum * ENEMY_TYPE_MAX + t],
    );
  }
}

// ---- minimap.py --------------------------------------------------------------

// [ redeye, bomber, lander, mutant, pod, swarmer ]
const ENEMY_COLOUR: i32[] = [color.YELLOW, color.GREEN, color.RED, color.LIME, color.PURPLE, color.PINK];

const MINIMAP_WIDTH: i32 = 128;
const MINIMAP_HEIGHT: i32 = 8;

/** int(x * width / ground.width - scroll_x) % width, for a fixed-point world x. */
function minimapX(x: i32, scroll: i32): i32 {
  // A minimap pixel is 8 pixels of ground; the width is a power of two.
  return truncShift(x - scroll * 8 * FX, FX_BITS + 3) & (MINIMAP_WIDTH - 1);
}

/** (y / pyxel.height) * 8, rounded as Pyxel draws it. */
function minimapY(y: i32): i32 {
  return roundShift(y, FX_BITS + 4);
}

// The black band and the ground's dots do not change during a stage: they
// are drawn into image bank 1 with the stage's ground, a column for every 8
// of ground, and copied from there, rotated by the scroll.
const MINIMAP_V: i32 = 128;
let minimapV = MINIMAP_V;
let nextMinimapV = MINIMAP_V + 16;
let nextMinimapColumns = 0;

/** Draws `count` more columns of the next stage's minimap. */
function makeMinimapColumns(count: i32): void {
  const divWidth = 8; // ground.width / width
  if (nextMinimapColumns === 0) image.rect(1, 0, nextMinimapV, MINIMAP_WIDTH, MINIMAP_HEIGHT + 1, color.BLACK);
  const end = min(MINIMAP_WIDTH, nextMinimapColumns + count);
  for (let x = nextMinimapColumns; x < end; x++) {
    const height = surfaces[1 - surfaceCur][x * divWidth];
    const col = height >= LAVA_HEIGHT * FX ? color.NAVY : color.PURPLE;
    // height * height // ground.max_height: height * 8 // 64
    image.pset(1, x, nextMinimapV + MINIMAP_HEIGHT - (height >> (FX_BITS + 3)), col);
  }
  nextMinimapColumns = end;
}

function minimapDraw(): void {
  const playerX = truncShift(player.x, FX_BITS + 3); // int(player.x * width / ground.width)
  const scroll = playerX - idiv(MINIMAP_WIDTH, 2);

  // pyxel.rect(0, 0, pyxel.width, self.height, BLACK) and the ground's dots,
  // whose lowest row lies below the band.
  let column = 0;
  while (column < MINIMAP_WIDTH) {
    const u = (column + scroll) & (MINIMAP_WIDTH - 1);
    const n = min(MINIMAP_WIDTH - column, MINIMAP_WIDTH - u);
    screen.blt(column, 0, 1, u, minimapV, n, MINIMAP_HEIGHT);
    screen.blt(column, MINIMAP_HEIGHT, 1, u, minimapV + MINIMAP_HEIGHT, n, 1, color.BLACK);
    column += n;
  }

  // Draw the player
  screen.circ(idiv(MINIMAP_WIDTH, 2), minimapY(player.y), 1, color.WHITE);

  // Draw humans
  for (let h = 0; h < len(humans); h++) screen.pset(minimapX(humans[h].x, scroll), minimapY(humans[h].y), color.WHITE);

  // Draw Collectables
  for (let c = 0; c < len(collectables); c++)
    screen.circ(minimapX(collectables[c].x, scroll), minimapY(collectables[c].y), 1, color.DARK_BLUE);

  // Draw enemies (an enemy listed twice draws the same pixels twice)
  for (let e = 0; e < len(enemies); e++) {
    const enemyX = minimapX(enemies[e].x, scroll),
      enemyY = minimapY(enemies[e].y);
    screen.pset(enemyX, enemyY, ENEMY_COLOUR[enemies[e].type]);
    if (enemies[e].type === ENEMY_TYPE_LANDER && isBeamingUpHuman(e)) screen.circb(enemyX, enemyY, 3, color.RED);
  }

  // Screen width lines
  const lineScroll = !player.flipX ? 4 : -4;
  const x = 55 + lineScroll;
  screen.line(x, 7, x + 16, 7, color.DARK_BLUE);
}

// ---- hud.py ------------------------------------------------------------------

const ANCHOR_Y: i32 = 120;

const HUMAN_X: i32 = 56;

const CYCLE_COLOURS: i32[] = [3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** CYCLE_COLOURS[floor(frame_count * 0.2) % len(CYCLE_COLOURS)] */
function cycleColour(): i32 {
  return CYCLE_COLOURS[idiv(system.frameCount(), 5) % len(CYCLE_COLOURS)];
}

// Text costs allocations on the GBA, so the HUD is copied from image bank
// 0: its black band with the human icon and the ":", made once, as are the
// counts 00 to 19 in each colour the HUD shows them in (no count exceeds 19)
// and panels of 1 to 3 life icons. The score, whose colour cycles, is drawn
// each frame from text made when it changes.
const HUD_V: i32 = 216;
const LIVES_V: i32 = 224;
const MAX_LIVES: i32 = 3;
/** Where the counts are: 00 to 19 in a row per colour, 8 x 6 pixels each. */
const COUNTS_U: i32 = 32;
const COUNTS_V: i32 = 224;
const MAX_COUNT: i32 = 19;
/** The colours of the HUD's counts: humans of the stage, rescued, mutants. */
const COUNT_COLOURS: i32[] = [7, 3, 8];
let hudScore = -1;
let hudScoreText = "";

/** The strip's black band, human icon and ":", the counts and the lives panels. */
function makeHudImg(): void {
  const w = system.width();
  image.rect(0, 0, HUD_V, w, 8, 0);
  image.blt(0, HUMAN_X + 8, HUD_V, 0, ANIM_HUMAN[0] * 8, 0, 8, 8);
  image.text(0, HUMAN_X + 26, HUD_V + 1, ":", 7);
  image.rect(0, COUNTS_U, COUNTS_V, (MAX_COUNT + 1) * 8, len(COUNT_COLOURS) * text.FONT_HEIGHT, 0);
  for (let c = 0; c < len(COUNT_COLOURS); c++)
    for (let n = 0; n <= MAX_COUNT; n++)
      image.text(0, COUNTS_U + n * 8, COUNTS_V + c * text.FONT_HEIGHT, text.zfill(n, 2), COUNT_COLOURS[c]);
  // Panel n holds the icons of n lives in the rightmost MAX_LIVES * 9 pixels.
  for (let n = 1; n <= MAX_LIVES; n++) {
    const v = LIVES_V + (n - 1) * 8;
    image.rect(0, 0, v, MAX_LIVES * 9, 8, 0);
    for (let i = 0; i < n; i++) image.blt(0, (MAX_LIVES - n) * 9 + i * 9, v, 0, IMG_JETMAN_IDLE * 8, 0, 8, 8);
  }
}

/** pyxel.text(x, ANCHOR_Y + 1, f"{count:02}", COUNT_COLOURS[colour]) over the black band. */
function hudCount(x: i32, count: i32, colour: i32): void {
  if (count <= MAX_COUNT)
    screen.blt(x, ANCHOR_Y + 1, 0, COUNTS_U + count * 8, COUNTS_V + colour * text.FONT_HEIGHT, 8, text.FONT_HEIGHT);
  else screen.text(x, ANCHOR_Y + 1, text.zfill(count, 2), COUNT_COLOURS[colour]);
}

function hudDraw(): void {
  const w = system.width();
  if (score !== hudScore) {
    hudScore = score;
    // f"SC:{score:06}" in one string: text.zfill() would build it a digit at a time.
    hudScoreText = `SC:${idiv(score, 100000) % 10}${idiv(score, 10000) % 10}${idiv(score, 1000) % 10}${idiv(score, 100) % 10}${idiv(score, 10) % 10}${score % 10}`;
  }

  // pyxel.rect(0, pyxel.height - 8, pyxel.width, 8, 0), the human icon and ":"
  screen.blt(0, system.height() - 8, 0, 0, HUD_V, w, 8);

  const col = cycleColour();
  screen.text(2, ANCHOR_Y + 1, hudScoreText, col);

  hudCount(HUMAN_X, HUMANS_PER_STAGE[stageNum], 0);
  hudCount(HUMAN_X + 16, humansRescued, 1);
  hudCount(HUMAN_X + 32, mutantsCreated, 2);

  // Draw lives: pyxel.blt(pyxel.width - 2 - lives * 9 + i * 9, ANCHOR_Y, ...) for each
  if (lives > 0)
    screen.blt(w - 2 - MAX_LIVES * 9, ANCHOR_Y, 0, 0, LIVES_V + (min(lives, MAX_LIVES) - 1) * 8, MAX_LIVES * 9, 8);
}

// ---- gameplay.py -------------------------------------------------------------

const STATE_GET_READY: i32 = 0;
const STATE_PLAY: i32 = 1;
const STATE_PLAYER_EXPLODE: i32 = 2;
const STATE_STAGE_COMPLETE: i32 = 3;
const STATE_GAME_OVER: i32 = 4;
const STATE_PAUSED: i32 = 5;
const STATE_BEAM_UP_HUMAN: i32 = 6;

const GET_READY_FRAMES: i32 = 120;
const GAME_OVER_FRAMES: i32 = 180;
const STAGE_COMPLETE_FRAMES: i32 = 180;

const CHECK_NEW_SHIELD_FRAMES: i32 = 120;

let stageNum = 0;
let gameplayState = STATE_GET_READY;
let stateBeforePause = STATE_GET_READY;
let scrollX = 0;
let scrollXTarget = 0;
/** The id of the human the player beams up, or -1. */
let humanToBeamUp = -1;
let mutantsCreated = 0;
let humansRescued = 0;
let currentAbductions = 0;
let shieldCnt = 0;
let spawnShieldCheckFrames = CHECK_NEW_SHIELD_FRAMES;
let stageFrames = 0;
let timeBonusAchieved = false;
let lives = 3;
let score = 0;
let stateFrameCnt = 0;

/** Gameplay.__init__ */
function newGameplay(stage: i32): void {
  stageNum = stage;
  gameplayState = STATE_GET_READY;
  stateBeforePause = STATE_GET_READY;

  newJetman();
  newGround();
  newLava(EM_LAVA, idiv(system.width() * FX, 2), (system.height() - LAVA_HEIGHT) * FX);
  scrollX = 0;
  scrollXTarget = 0;
  lasers = [];
  truncate(emitters, FIRST_EXPLOSION); // explosions
  enemies = [];
  enemyBullets = [];
  enemySpawns = [];
  createAllSpawns();

  humans = [];
  spawnAllHumans();
  humanToBeamUp = -1;
  mutantsCreated = 0;
  humansRescued = 0;
  currentAbductions = 0;

  collectables = [];
  shieldCnt = 0;
  spawnShieldCheckFrames = CHECK_NEW_SHIELD_FRAMES;

  newStarfield(SF_GAME);

  stageFrames = 0;
  timeBonusAchieved = false;

  lives = 3;
  score = 0;

  stateFrameCnt = 0;

  switchState(STATE_GET_READY);
  jetmanRespawn();
  lives = max(0, lives - 1);
}

function addScore(sc: i32): void {
  score = min(MAX_SCORE, score + sc);
}

function playerDied(): void {
  lasers = [];
  newPlayerExplosion();
  switchState(STATE_PLAYER_EXPLODE);
}

function updateEffects(): void {
  // lerp(scroll_x, scroll_x_target, 0.1)
  scrollX += idiv(scrollXTarget - scrollX, 10);
  lavaUpdate(EM_LAVA);
  starfieldUpdate(SF_GAME);
  let finished = false;
  for (let e = FIRST_EXPLOSION; e < len(emitters); e++) {
    explosionUpdate(e);
    if (emitters[e].finished) finished = true;
  }
  if (finished) emitters = filter(emitters, (emitter, index) => index < FIRST_EXPLOSION || !emitter.finished);
}

function checkNewShieldRequired(): void {
  spawnShieldCheckFrames--;
  if (spawnShieldCheckFrames === 0) {
    spawnShieldCheckFrames = CHECK_NEW_SHIELD_FRAMES;
    if (!player.hasShield && shieldCnt === 0) newCollectableShield();
  }
}

// Lists are filtered only when something is to be removed: a new list costs
// an allocation and a copy.

function updateObjects(): void {
  let removed = false;
  for (let s = 0; s < len(lasers); s++) {
    laserUpdate(s);
    if (lasers[s].remove) removed = true;
  }
  if (removed) lasers = filter(lasers, (laser) => !laser.remove);
  jetmanUpdate();

  checkNewShieldRequired();
  removed = false;
  for (let c = 0; c < len(collectables); c++) {
    collectableUpdate(c);
    if (collectables[c].remove) removed = true;
  }
  if (removed) collectables = filter(collectables, (collectable) => !collectable.remove);

  for (let h = 0; h < len(humans); h++) humanUpdate(h);

  for (let e = 0; e < len(enemySpawns); e++) enemySpawnUpdate(e);

  // Enemies appended while the list is updated are updated too.
  let n = 0;
  while (n < len(enemies)) {
    const refs = enemies[n].refs;
    for (let r = 0; r < refs; r++) enemyUpdate(n);
    n++;
  }
  removed = false;
  for (let e = 0; e < len(enemies); e++) if (enemies[e].remove) removed = true;
  if (removed) enemies = filter(enemies, (enemy) => !enemy.remove);

  removed = false;
  for (let b = 0; b < len(enemyBullets); b++) {
    enemyBulletUpdate(b);
    if (enemyBullets[b].remove) removed = true;
  }
  if (removed) enemyBullets = filter(enemyBullets, (bullet) => !bullet.remove);
}

function checkForGameOver(): boolean {
  return mutantsCreated > idiv(HUMANS_PER_STAGE[stageNum], 2);
}

function updateGetReady(): i32 {
  // The next stage's ground starts after the stage's first frame (see generateSurface).
  if (nextSurfaceColumns < 0 && stageNum < NUM_STAGES - 1) startNextSurface();
  if (stateFrameCnt === GET_READY_FRAMES) switchState(STATE_PLAY);
  updateEffects();
  return STATE_NONE;
}

function playerDiedInLavaCheck(): boolean {
  if (player.hasShield) return false;
  if (player.y + 7 * FX > (system.height() - LAVA_HEIGHT) * FX) {
    if (jetmanGotHitCheck()) {
      playerDied();
      return true;
    }
  }
  return false;
}

function playerHitEnemyBulletCheck(): boolean {
  for (let b = 0; b < len(enemyBullets); b++) {
    if (jetmanHitRectCheck(enemyBullets[b].x, enemyBullets[b].y, BULLET_SIZE * FX, BULLET_SIZE * FX)) {
      enemyBullets[b].remove = true;
      if (jetmanGotHitCheck()) {
        playerDied();
        return true;
      }
    }
  }
  return false;
}

function playerHitEnemyCheck(): boolean {
  // Enemies appended while the list is checked are checked too.
  let n = 0;
  while (n < len(enemies)) {
    for (let r = 0; r < enemies[n].refs; r++) {
      if (enemies[n].invincibleFrames > 0) continue;
      if (jetmanHitRectCheck(enemies[n].x, enemies[n].y, SPRITE_SIZE * FX, SPRITE_SIZE * FX)) {
        enemyDestroy(n);
        if (jetmanGotHitCheck()) {
          playerDied();
          return true;
        }
      }
    }
    n++;
  }
  return false;
}

function updatePlay(): i32 {
  if (currentInput.buttonStart) {
    stateBeforePause = STATE_PLAY;
    switchState(STATE_PAUSED);
    return STATE_NONE;
  }

  if (playerDiedInLavaCheck()) return STATE_NONE;

  if (playerHitEnemyBulletCheck()) return STATE_NONE;

  if (playerHitEnemyCheck()) return STATE_NONE;

  humanToBeamUp = rescuedHumanCheck();
  if (humanToBeamUp >= 0) {
    switchState(STATE_BEAM_UP_HUMAN);
    return STATE_NONE;
  }

  updateObjects();

  if (checkForGameOver()) {
    switchState(STATE_GAME_OVER);
    return STATE_NONE;
  }

  // Last human was mutated but not > half, so stage complete.
  if (len(humans) === 0) {
    switchState(STATE_STAGE_COMPLETE);
    return STATE_NONE;
  }

  if (player.flipX) scrollXTarget = player.x - 96 * FX;
  else scrollXTarget = player.x - 24 * FX;

  updateEffects();

  stageFrames++;

  prepareNextGround(1);

  return STATE_NONE;
}

function centreScrollX(): void {
  scrollXTarget = player.x - 60 * FX;
}

function updatePlayerExplode(): i32 {
  updateEffects();
  if (len(emitters) === FIRST_EXPLOSION) {
    if (lives > 0) {
      switchState(STATE_GET_READY);
      jetmanRespawn();
      lives = max(0, lives - 1);
      enemyBullets = [];
    } else {
      switchState(STATE_GAME_OVER);
    }
  }
  return STATE_NONE;
}

function updateBeamUpHuman(): i32 {
  if (currentInput.buttonStart) {
    stateBeforePause = STATE_BEAM_UP_HUMAN;
    switchState(STATE_PAUSED);
    return STATE_NONE;
  }

  const h = humanIndex(humanToBeamUp);
  humanUpdate(h);
  if (humans[h].remove) {
    addScore(SCORE_RESCUE_HUMAN);
    switchState(STATE_PLAY);
    humans[h].remove = true;
    humansRescued++;
    humans = filter(humans, (human) => !human.remove);
  }
  if (len(humans) === 0) {
    if (stageFrames < STAGE_MAX_TIME_BONUS[stageNum] * 60) {
      timeBonusAchieved = true;
      addScore(SCORE_TIME_BONUS);
    }
    if (humansRescued === HUMANS_PER_STAGE[stageNum]) addScore(SCORE_100PC_RESCUE_BONUS);
    playSound(SND_STAGE_COMPLETE);
    switchState(STATE_STAGE_COMPLETE);
  }
  return STATE_NONE;
}

function updateStageComplete(): i32 {
  if (stageNum < NUM_STAGES - 1) {
    prepareNextGround(GROUND_COLUMNS_PER_FRAME);
  }
  if (stateFrameCnt === STAGE_COMPLETE_FRAMES) {
    if (stageNum === NUM_STAGES - 1) return STATE_GAME_COMPLETE;
    else return STATE_LOAD_NEXT_STAGE;
  }

  updateEffects();

  return STATE_NONE;
}

function updateGameOver(): i32 {
  if (stateFrameCnt === GAME_OVER_FRAMES) return STATE_MAIN_MENU;
  updateEffects();
  return STATE_NONE;
}

function updatePaused(): i32 {
  if (currentInput.buttonStart) switchState(stateBeforePause);
  else if (currentInput.button2) return STATE_MAIN_MENU;
  return STATE_NONE;
}

function switchState(newState: i32): void {
  gameplayState = newState;
  stateFrameCnt = 0;
}

function gameplayUpdate(): i32 {
  stateFrameCnt++;

  if (gameplayState === STATE_GET_READY) return updateGetReady();
  else if (gameplayState === STATE_PLAY) return updatePlay();
  else if (gameplayState === STATE_PAUSED) return updatePaused();
  else if (gameplayState === STATE_GAME_OVER) return updateGameOver();
  else if (gameplayState === STATE_PLAYER_EXPLODE) return updatePlayerExplode();
  else if (gameplayState === STATE_BEAM_UP_HUMAN) return updateBeamUpHuman();
  // self.state == STATE_STAGE_COMPLETE:
  return updateStageComplete();
}

function gameplayDraw(): void {
  // The ground first, then what it covers where it does not (see groundDraw).
  groundUpdateTops(scrollX);
  groundDraw(scrollX);
  starfieldDraw(SF_GAME, scrollX);
  lavaDraw(EM_LAVA, scrollX);

  for (let h = 0; h < len(humans); h++) humanDraw(h, scrollX);

  for (let c = 0; c < len(collectables); c++) collectableDraw(c, scrollX);

  // Relative camera
  screen.camera(fxRound(scrollX), 0);
  for (let s = 0; s < len(lasers); s++) laserDraw(s);
  jetmanDraw();
  for (let e = FIRST_EXPLOSION; e < len(emitters); e++) emitterDraw(e);

  // Reset camera
  screen.camera();
  for (let e = 0; e < len(enemySpawns); e++) enemySpawnDraw(e, scrollX);
  // An enemy listed twice draws the same pixels twice: once is enough.
  for (let e = 0; e < len(enemies); e++) enemyDraw(e, scrollX);
  for (let b = 0; b < len(enemyBullets); b++) enemyBulletDraw(b, scrollX);

  minimapDraw();
  hudDraw();

  if (gameplayState === STATE_GET_READY) {
    drawCentreXLabelImg(24, LABEL_STAGE + stageNum); // f"STAGE {self.stage_num + 1}"
    drawCentreXLabelImg(56, LABEL_GET_READY);
  } else if (gameplayState === STATE_PAUSED) {
    drawCentreXLabelImg(56, LABEL_PAUSED);
    drawCentreXLabelImg(72, LABEL_PRESS_B);
  } else if (gameplayState === STATE_GAME_OVER) {
    drawCentreXLabelImg(56, LABEL_GAME_OVER);
  } else if (gameplayState === STATE_STAGE_COMPLETE) {
    drawCentreXLabelImg(56, LABEL_STAGE_COMPLETE);
    if (timeBonusAchieved) drawCentreXLabelImg(24, LABEL_TIME_BONUS);
    if (humansRescued === HUMANS_PER_STAGE[stageNum]) drawCentreXLabelImg(40, LABEL_RESCUE_BONUS);
  }
}

// ---- main_menu.py ------------------------------------------------------------

const STATE_TOP_LASER: i32 = 0;
const STATE_TITLE_LASER: i32 = 1;
const STATE_BOTTOM_LASER: i32 = 2;
const STATE_AWAIT_INPUT: i32 = 3;

const STATE_TOP_LASER_FRAMES: i32 = 40;
const STATE_TITLE_LASER_FRAMES: i32 = 70;
const STATE_BOTTOM_LASER_FRAMES: i32 = 95;

// The 47 x 18 title image, in bank 0.
const TITLE_U: i32 = 0;
const TITLE_V: i32 = 16;
const TITLE_W: i32 = 47;
const TITLE_H: i32 = 18;

let menuState = STATE_TOP_LASER;
let menuStateFrames = 0;

function mainMenuEnter(): void {
  emitters[EM_MENU] = makeSparksEmitter();
  menuSwitchState(STATE_TOP_LASER);
  sound.stop();
  playSound(SND_JETPACK_FIRE, true);
}

function makeSparksEmitter(): Emitter {
  const e = newEmitter(40 * FX, 0, 50, 30);
  e.particlesShape = PARTICLES_SHAPE_POINT;
  e.particlesPerFrame = 5;
  e.particleLifeMin = 10;
  e.particleLifeMax = 30;
  //
  e.particleColorOrder = [10, 9, 8, 1];
  return e;
}

function menuSwitchState(newState: i32): void {
  menuState = newState;
  menuStateFrames = 0;
}

function updateTopLaser(): i32 {
  emitters[EM_MENU].y = lerpFx(0, 33 * FX, menuStateFrames, STATE_TOP_LASER_FRAMES);
  emitterEmit(EM_MENU);
  if (menuStateFrames === STATE_TOP_LASER_FRAMES) {
    menuSwitchState(STATE_TITLE_LASER);
    emitters[EM_MENU].y += 9 * FX;
    emitters[EM_MENU].particleYPosRange = 10 * FX;
  }
  return STATE_NONE;
}

function updateTitleLaser(): i32 {
  emitters[EM_MENU].x = 40 * FX + lerpFx(0, 47 * FX, menuStateFrames, STATE_TITLE_LASER_FRAMES);
  emitterEmit(EM_MENU);
  if (menuStateFrames === STATE_TITLE_LASER_FRAMES) {
    menuSwitchState(STATE_BOTTOM_LASER);
    emitters[EM_MENU].y += 9 * FX;
    emitters[EM_MENU].particleYPosRange = FX;
  }
  return STATE_NONE;
}

function updateBottomLaser(): i32 {
  emitters[EM_MENU].y = 50 * FX + lerpFx(0, 78 * FX, menuStateFrames, STATE_BOTTOM_LASER_FRAMES);
  emitterEmit(EM_MENU);
  if (menuStateFrames === STATE_BOTTOM_LASER_FRAMES) {
    sound.stop();
    playSound(SND_PLAYER_EXPLOSION);
    menuSwitchState(STATE_AWAIT_INPUT);
  }
  return STATE_NONE;
}

function updateAwaitInput(): i32 {
  if (currentInput.buttonStart) return STATE_GAMEPLAY;
  return STATE_NONE;
}

function makeTitleImg(): void {
  const laser: i32[] = [
    IMG_TITLE_LETTER_L,
    IMG_TITLE_LETTER_A,
    IMG_TITLE_LETTER_S,
    IMG_TITLE_LETTER_E,
    IMG_TITLE_LETTER_R,
  ];
  const jetman: i32[] = [
    IMG_TITLE_LETTER_J,
    IMG_TITLE_LETTER_E,
    IMG_TITLE_LETTER_T,
    IMG_TITLE_LETTER_M,
    IMG_TITLE_LETTER_A,
    IMG_TITLE_LETTER_N,
  ];

  image.rect(0, TITLE_U, TITLE_V, TITLE_W, TITLE_H, 0);

  for (let i = 0; i < len(laser); i++) image.blt(0, TITLE_U + i * 8, TITLE_V, 0, laser[i] * 8, 0, 8, 8, 0);

  // The last column of N lies outside the 47 pixels of the title.
  for (let i = 0; i < len(jetman); i++) image.blt(0, TITLE_U + i * 8, TITLE_V + 10, 0, jetman[i] * 8, 0, 8, 8, 0);
}

function mainMenuUpdate(): i32 {
  // The next stage's ground starts in the first frame after enter().
  if (nextSurfaceColumns < 0) startNextSurface();
  else prepareNextGround(GROUND_COLUMNS_PER_FRAME);
  menuStateFrames++;
  emitterUpdate(EM_MENU);
  if (menuState === STATE_TOP_LASER) return updateTopLaser();
  else if (menuState === STATE_TITLE_LASER) return updateTitleLaser();
  else if (menuState === STATE_BOTTOM_LASER) return updateBottomLaser();
  // if self.state == STATE_AWAIT_INPUT:
  return updateAwaitInput();
}

function mainMenuDraw(): void {
  if (menuState === STATE_TOP_LASER) {
    const n = lerpFx(0, 33 * FX, menuStateFrames, STATE_TOP_LASER_FRAMES);
    screen.line(40, 0, 40, fxRound(n), 8);
  } else if (menuState === STATE_TITLE_LASER) {
    screen.line(40, 0, 40, 33, 8);
    const n = lerpFx(0, 47 * FX, menuStateFrames, STATE_TITLE_LASER_FRAMES);
    screen.blt(40, 32, 0, TITLE_U, TITLE_V, fxRound(n), TITLE_H, 0);
  } else if (menuState === STATE_BOTTOM_LASER) {
    screen.line(40, 0, 40, 33, 8);
    screen.blt(40, 32, 0, TITLE_U, TITLE_V, TITLE_W, TITLE_H, 0);
    const n = lerpFx(0, 78 * FX, menuStateFrames, STATE_BOTTOM_LASER_FRAMES);
    screen.line(86, 50, 86, 50 + fxRound(n), 8);
  } else {
    // if self.state == STATE_AWAIT_INPUT:
    screen.line(40, 0, 40, 33, 8);
    screen.blt(40, 32, 0, TITLE_U, TITLE_V, TITLE_W, TITLE_H, 0);
    screen.line(86, 50, 86, 128, 8);
    drawCentreXLabelImg(80, LABEL_PRESS_START);

    screen.text(34, 120, `HI-SCORE:${text.zfill(highScore, 6)}`, cycleColour());
  }

  emitterDraw(EM_MENU);
}

// ---- game_complete.py --------------------------------------------------------

let noSkipFrameCnt = 0;
let finalScore = 0;

function newGameComplete(): void {
  noSkipFrameCnt = 0;
  finalScore = 0;
  newLava(EM_COMPLETE_LAVA, idiv(system.width() * FX, 2), (system.height() - LAVA_HEIGHT) * FX);
  newStarfield(SF_COMPLETE);
}

function gameCompleteEnter(): void {
  playSound(SND_GAME_COMPLETE_DRUMS, true);
  playSound(SND_GAME_COMPLETE_MELODY, true);
}

function gameCompleteUpdate(): i32 {
  noSkipFrameCnt++;

  lavaUpdate(EM_COMPLETE_LAVA);
  starfieldUpdate(SF_COMPLETE);

  if (noSkipFrameCnt > 180) {
    if (currentInput.buttonStart) {
      sound.stop();
      return STATE_MAIN_MENU;
    }
  }

  return STATE_NONE;
}

function gameCompleteDraw(): void {
  groundClearTops();
  starfieldDraw(SF_COMPLETE, 0);
  lavaDraw(EM_COMPLETE_LAVA, 0);

  const y = 40 * FX + cosA(math.mod(system.frameCount() * 4, 360) * ANGLE_UNITS) * 8;
  drawCentreXLabelImg(fxRound(y), LABEL_CONGRATULATIONS);
  drawCentreXLabel(72, `FINAL SCORE: ${text.zfill(finalScore, 6)}`, cycleColour());
}

// ---- app.py ------------------------------------------------------------------

let appState = STATE_MAIN_MENU;
let currentInput: Input = {
  up: false,
  down: false,
  left: false,
  right: false,
  button1: false,
  button2: false,
  buttonStart: false,
};
let highScore = 0;

export function setup(): void {
  appState = STATE_MAIN_MENU; // STATE_GAME_COMPLETE
  // display_scale, capture_scale and capture_sec do not apply on the GBA.
  system.init(128, 128, 60);
  // RETURN pauses; keep it off A, which fires.
  input.map(input.key.RETURN, input.gba.START);

  makeSinTable();
  makeLifeRecips();

  for (let e = 0; e < FIRST_EXPLOSION; e++) push(emitters, newEmitter(0, 0, 0, 1));
  makeAll();
  makeTitleImg();
  makeLabels();
  makeHudImg();
  // Bank 1 holds the ground (see groundDraw): its copy into RAM happens now.
  image.cls(1, 0);
  // The circles the game draws, from particles to rings, measure their radii
  // on first use: once here rather than in the first frame of play.
  for (let r = 0; r <= SPAWN_RADIUS; r++) {
    screen.circ(64, 64, r, 0);
    screen.circb(64, 64, r, 0);
  }
  screen.cls(0);
  addAll();
  highScore = 0;
  mainMenuEnter();
  newGameComplete();
}

export function update(): void {
  currentInput = poll();
  let newState = STATE_NONE;

  if (appState === STATE_MAIN_MENU) {
    newState = mainMenuUpdate();
  } else if (appState === STATE_GAMEPLAY) {
    newState = gameplayUpdate();
    highScore = max(score, highScore);
  } else if (appState === STATE_GAME_COMPLETE) {
    newState = gameCompleteUpdate();
  }

  if (newState !== STATE_NONE) {
    if (newState === STATE_GAMEPLAY) {
      newStage(0);
    } else if (newState === STATE_LOAD_NEXT_STAGE) {
      loadNextStage();
    } else if (newState === STATE_MAIN_MENU) {
      appState = STATE_MAIN_MENU;
      mainMenuEnter();
    } else if (newState === STATE_GAME_COMPLETE) {
      appState = STATE_GAME_COMPLETE;
      finalScore = score;
      gameCompleteEnter();
    }
  }
}

function loadNextStage(): void {
  const savedLives = lives;
  const savedScore = score;
  newStage(stageNum + 1);
  lives = savedLives;
  score = savedScore;
}

function newStage(stage: i32): void {
  appState = STATE_GAMEPLAY;
  math.rseed(system.frameCount());
  // pyxel.nseed(pyxel.rndi(0, pyxel.frame_count)): see startNextSurface().
  newGameplay(stage);
}

export function draw(): void {
  screen.cls(0);
  if (appState === STATE_MAIN_MENU) mainMenuDraw();
  else if (appState === STATE_GAMEPLAY) gameplayDraw();
  else if (appState === STATE_GAME_COMPLETE) gameCompleteDraw();
}
