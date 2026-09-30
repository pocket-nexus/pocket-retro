#!/usr/bin/env bun
/**
 * Records the README's animated GIFs into docs/assets: games/<game>.gif, a
 * few seconds of a game on its own screen, and showcase.gif, clips of
 * several games on a pixel-art Game Boy Advance.
 *
 *   bun tools/media.ts                  every game in DEMOS and the showcase
 *   bun tools/media.ts jump snake       only these games' GIFs
 *   bun tools/media.ts --showcase       only the showcase
 *
 * Games are built first. The emulator is deterministic, so a demo records
 * the same GIF every time until the game or the SDK changes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGame, ROOT } from "./build.ts";
import { Gba, SCREEN_HEIGHT, SCREEN_WIDTH } from "./emu/mgba.ts";
import { encodeGif } from "./lib/gif.ts";
import { crop, parseScript, REFRESH_RATE, screenRect } from "./run.ts";

interface Demo {
  /** Input, as in tools/run.ts; recording ends with it. */
  script: string;
  /** VBlanks played before recording starts. */
  skip: number;
}

/** What each game's GIF shows. */
const DEMOS: Record<string, Demo> = {
  jump: {
    script: "20:- 42:LEFT 58:RIGHT 74:LEFT 62:RIGHT 8:LEFT 26:RIGHT 72:LEFT 64:RIGHT 54:LEFT 48:RIGHT 24:- 38:RIGHT",
    skip: 30,
  },
  // Seven apples; the display is black until VBlank 28.
  snake: {
    script: "23:- 63:RIGHT 6:UP 30:RIGHT 96:DOWN 102:LEFT 21:DOWN 78:RIGHT 117:UP 21:LEFT 27:DOWN 9:RIGHT 15:DOWN",
    skip: 28,
  },
  // The ship fires when A goes down, so A is tapped.
  shooter: {
    script:
      "34:- 2:START 2:A 2:- 4:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 4:LEFT 2:UP 2:A+UP 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+UP 6:UP 2:A+UP 4:UP 2:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 2:LEFT 4:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 6:RIGHT 2:A+RIGHT 2:RIGHT 4:UP 2:A+UP 6:UP 2:A+UP 6:UP 2:A+UP 6:UP 2:A+UP 2:UP 4:- 2:A 2:- 4:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 7:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 2:A+LEFT 6:LEFT 1:A+UP",
    skip: 60,
  },
  platformer: {
    script:
      "26:- 108:RIGHT 2:RIGHT+A 18:RIGHT 2:RIGHT+A 94:RIGHT 2:RIGHT+A 6:RIGHT 2:RIGHT+A 14:RIGHT 2:RIGHT+A 86:RIGHT 8:- 2:RIGHT+A 86:RIGHT 2:RIGHT+A 50:RIGHT 2:RIGHT+A 118:RIGHT",
    skip: 60,
  },
  // Found by a planner that read the game's state and played ahead: four rescues among 8-11 meteors.
  space_rescue: {
    script:
      "60:- 4:START 2:- 52:A 550:- 146:A 2:- 154:A 50:- 56:A 80:- 2:A 36:- 8:A 34:- 74:A 2:- 2:A 2:- 38:A 146:- 202:A 54:- 2:A 12:- 28:A 78:- 2:A 6:- 14:A 12:- 2:A 22:- 20:A 26:- 76:A 4:- 118:A 2:- 300:A 16:- 26:A 72:- 6:A 2:- 42:A 136:- 64:A 68:- 2:A 16:- 16:A 116:- 12:A 12:- 14:A 10:- 24:A 8:- 26:A 6:- 4:A 10:- 112:A",
    skip: 2400,
  },
};

/** Clips of the showcase: a game's demo from its skip, for this many VBlanks. */
const SHOWCASE: { game: string; vblanks: number }[] = [
  { game: "jump", vblanks: 240 },
  { game: "shooter", vblanks: 240 },
  { game: "platformer", vblanks: 240 },
  { game: "snake", vblanks: 180 },
];

/** Every other VBlank: 30 images a second, GIF delays of 3 and 4 centiseconds. */
const STEP = 2;
const ASSETS = resolve(ROOT, "docs/assets");

interface Capture {
  /** Whole 240 x 160 displays, RGBA. */
  frames: Uint8Array[];
  /** The game's screen size from its boot log. */
  width: number;
  height: number;
}

const roms = new Map<string, string>();

async function capture(game: string, demo: Demo, vblanks = Infinity): Promise<Capture> {
  if (!roms.has(game)) roms.set(game, (await buildGame(resolve(ROOT, "games", game))).rom);
  const gba = await Gba.open(roms.get(game)!);
  const frames: Uint8Array[] = [];
  try {
    let count = 0;
    for (const step of parseScript(demo.script)) {
      gba.setKeys(step.keys);
      for (let i = 0; i < step.frames && count < demo.skip + vblanks; i++) {
        gba.run(1);
        count++;
        if (count > demo.skip && (count - demo.skip) % STEP === 0) frames.push(gba.frame());
      }
    }
    const [, width, height] = gba.logText.match(/screen (\d+)x(\d+)/) ?? [];
    if (!width) throw new Error(`${game} did not report its screen size`);
    if (gba.logText.includes("panic")) throw new Error(`${game} panicked:\n${gba.logText}`);
    return { frames, width: Number(width), height: Number(height) };
  } finally {
    gba.close();
  }
}

async function recordGame(game: string): Promise<void> {
  const demo = DEMOS[game];
  if (!demo) throw new Error(`no demo for ${game} in tools/media.ts`);
  const { frames, width, height } = await capture(game, demo);
  const rect = screenRect(width, height);
  const gif = encodeGif(
    frames.map((frame) => ({ rgba: crop(frame, rect), duration: STEP / REFRESH_RATE })),
    rect.width,
    rect.height,
    2,
  );
  const path = resolve(ASSETS, "games", `${game}.gif`);
  writeFileSync(path, gif);
  console.log(`${path}: ${frames.length} frames, ${Math.round(gif.length / 1024)} KiB`);
}

// ---- The pixel-art console ---------------------------------------------

const INK = 0x000000,
  BODY = 0x7696de,
  SHADE = 0x395c98,
  LIGHT = 0xa9c1ff,
  BEZEL = 0x1d2240,
  KEYS = 0x2b335f,
  RED = 0xd4186c,
  PINK = 0xff9798,
  WHITE = 0xeeeeee,
  LED = 0x70c6a9;

/** The logo's bold 6 x 7 letters, for the label under the screen. */
const GLYPHS: Record<string, string[]> = {
  P: ["#####.", "##..##", "##..##", "#####.", "##....", "##....", "##...."],
  O: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  C: [".#####", "##....", "##....", "##....", "##....", "##....", ".#####"],
  K: ["##..##", "##.##.", "####..", "###...", "####..", "##.##.", "##..##"],
  E: ["######", "##....", "##....", "#####.", "##....", "##....", "######"],
  T: ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."],
  R: ["#####.", "##..##", "##..##", "#####.", "##.##.", "##..##", "##..##"],
  " ": [],
};

class Canvas {
  readonly rgba: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rgba = new Uint8Array(width * height * 4);
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    const i = (y * this.width + x) * 4;
    return this.rgba[i + 3] === 0 ? -1 : (this.rgba[i]! << 16) | (this.rgba[i + 1]! << 8) | this.rgba[i + 2]!;
  }
  set(x: number, y: number, rgb: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.rgba.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, 255], (y * this.width + x) * 4);
  }
  rect(x: number, y: number, w: number, h: number, rgb: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, rgb);
  }
  /** A rectangle with corners rounded to radius r. */
  round(x: number, y: number, w: number, h: number, r: number, rgb: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const dx = i < r ? r - i - 0.5 : i >= w - r ? i - (w - r) + 0.5 : 0;
        const dy = j < r ? r - j - 0.5 : j >= h - r ? j - (h - r) + 0.5 : 0;
        if (dx * dx + dy * dy <= r * r) this.set(x + i, y + j, rgb);
      }
  }
  circle(cx: number, cy: number, r: number, rgb: number): void {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r) this.set(cx + i, cy + j, rgb);
  }
  /** Replaces `from` with `to` where the pixel `dy` rows away is not `from` or `to`: a shaded or lit edge. */
  edge(from: number, to: number, dy: number): void {
    const hits: number[] = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const next = this.get(x, y + dy);
        if (this.get(x, y) === from && next !== from && next !== to) hits.push(x, y);
      }
    for (let i = 0; i < hits.length; i += 2) this.set(hits[i]!, hits[i + 1]!, to);
  }
  text(x: number, y: number, text: string, rows: number[]): void {
    [...text].forEach((ch, k) =>
      GLYPHS[ch]!.forEach((row, j) =>
        [...row].forEach((bit, i) => bit === "#" && this.set(x + k * 7 + i, y + j, rows[j]!)),
      ),
    );
  }
}

interface Console {
  canvas: Canvas;
  /** Top left of the 240 x 160 display. */
  screenX: number;
  screenY: number;
}

/** A Game Boy Advance in the logo's colors, its display left transparent. */
export function drawConsole(): Console {
  const canvas = new Canvas(420, 240);
  const bodyX = 6,
    bodyY = 8,
    bodyW = 408,
    bodyH = 224;
  const screenX = bodyX + (bodyW - SCREEN_WIDTH) / 2,
    screenY = bodyY + 16;
  // Shoulder buttons, then the body with its outline, lit top and shaded bottom.
  canvas.round(bodyX + 22, bodyY - 5, 92, 24, 8, INK);
  canvas.round(bodyX + bodyW - 114, bodyY - 5, 92, 24, 8, INK);
  canvas.round(bodyX + 23, bodyY - 4, 90, 22, 7, SHADE);
  canvas.round(bodyX + bodyW - 113, bodyY - 4, 90, 22, 7, SHADE);
  canvas.round(bodyX + 2, bodyY + 3, bodyW, bodyH, 56, INK);
  canvas.round(bodyX - 1, bodyY - 1, bodyW + 2, bodyH + 2, 57, INK);
  canvas.round(bodyX, bodyY, bodyW, bodyH, 56, BODY);
  for (let dy = 1; dy <= 4; dy++) canvas.edge(BODY, SHADE, dy);
  canvas.edge(BODY, LIGHT, -1);
  canvas.edge(BODY, LIGHT, -2);
  // Bezel, power light and label.
  canvas.round(screenX - 14, screenY - 12, SCREEN_WIDTH + 28, SCREEN_HEIGHT + 36, 10, BEZEL);
  canvas.circle(screenX - 6, screenY + 20, 2, LED);
  canvas.set(screenX - 7, screenY + 19, WHITE);
  const label = [WHITE, WHITE, WHITE, WHITE, LIGHT, LIGHT, BODY];
  const sunset = [0xe9c35b, 0xe9c35b, 0xd38441, 0xd38441, RED, RED, 0x7e2072];
  const labelX = screenX + (SCREEN_WIDTH - 12 * 7) / 2,
    labelY = screenY + SCREEN_HEIGHT + 8;
  canvas.text(labelX, labelY, "POCKET", label);
  canvas.text(labelX + 7 * 7, labelY, "RETRO", sunset);
  // D-pad, Start and Select on the left wing.
  const padX = bodyX + 38,
    padY = bodyY + 84;
  canvas.round(padX - 21, padY - 8, 43, 17, 3, INK);
  canvas.round(padX - 8, padY - 21, 17, 43, 3, INK);
  canvas.rect(padX - 19, padY - 6, 39, 13, KEYS);
  canvas.rect(padX - 6, padY - 19, 13, 39, KEYS);
  canvas.circle(padX, padY, 3, BEZEL);
  for (const y of [padY + 64, padY + 80]) {
    canvas.round(bodyX + 30, y - 1, 18, 7, 3, INK);
    canvas.round(bodyX + 31, y, 16, 5, 2, KEYS);
  }
  // A and B on the right wing, then the speaker.
  for (const [x, y] of [
    [bodyX + bodyW - 30, padY - 12],
    [bodyX + bodyW - 58, padY + 8],
  ] as const) {
    canvas.circle(x + 1, y + 2, 11, SHADE);
    canvas.circle(x, y, 11, INK);
    canvas.circle(x, y, 9, RED);
    canvas.circle(x - 3, y - 3, 2, PINK);
  }
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 5 - j; i++) canvas.circle(bodyX + bodyW - 52 + i * 8 + j * 4, bodyY + 158 + j * 8, 1, SHADE);
  return { canvas, screenX, screenY };
}

async function recordShowcase(): Promise<void> {
  const { canvas, screenX, screenY } = drawConsole();
  const frames: Uint8Array[] = [];
  const show = (display: Uint8Array) => {
    const image = canvas.rgba.slice();
    for (let y = 0; y < SCREEN_HEIGHT; y++)
      image.set(
        display.subarray(y * SCREEN_WIDTH * 4, (y + 1) * SCREEN_WIDTH * 4),
        ((screenY + y) * canvas.width + screenX) * 4,
      );
    frames.push(image);
  };
  const blank = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  for (let i = 3; i < blank.length; i += 4) blank[i] = 255;
  for (const clip of SHOWCASE) {
    const { frames: clipFrames } = await capture(clip.game, DEMOS[clip.game]!, clip.vblanks);
    // A few dark frames between games, as when a cartridge is changed.
    for (let i = 0; i < 4; i++) show(blank);
    clipFrames.forEach(show);
  }
  const gif = encodeGif(
    frames.map((rgba) => ({ rgba, duration: STEP / REFRESH_RATE })),
    canvas.width,
    canvas.height,
    2,
  );
  const path = resolve(ASSETS, "showcase.gif");
  writeFileSync(path, gif);
  console.log(`${path}: ${frames.length} frames, ${Math.round(gif.length / 1024)} KiB`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const games = args.filter((arg) => !arg.startsWith("--"));
  const showcaseOnly = args.includes("--showcase");
  mkdirSync(resolve(ASSETS, "games"), { recursive: true });
  if (!showcaseOnly) for (const game of games.length > 0 ? games : Object.keys(DEMOS)) await recordGame(game);
  if (showcaseOnly || games.length === 0) await recordShowcase();
}
