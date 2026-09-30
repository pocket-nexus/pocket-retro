#!/usr/bin/env bun
/**
 * Runs a ROM headless in mGBA and records what it shows and prints.
 *
 *   bun tools/run.ts dist/hello.gba --frames=300 --shot=out.png
 *   bun tools/run.ts dist/jump.gba --script="60:A 4:- 30:RIGHT" --shot=out.png --wav=out.wav
 *   bun tools/run.ts dist/jump.gba --script="600:RIGHT" --gif=jump.gif --gif-skip=60
 *
 * A script is a list of `frames:KEYS` steps run in order; KEYS joins key
 * names with `+` (A, B, SELECT, START, RIGHT, LEFT, UP, DOWN, R, L) and `-`
 * releases every key. `--shots=<directory>` saves a PNG after each step.
 *
 * `--gif=<file>` records the game's screen as an animated GIF, one image
 * every `--gif-step` VBlanks (2, 30 a second) after the first `--gif-skip`,
 * scaled by `--gif-scale` (2); `--gif-full` keeps the whole 240 x 160 display.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Gba, KEY, SCREEN_HEIGHT, SCREEN_WIDTH, type KeyName } from "./emu/mgba.ts";
import { encodeGif, type GifFrame } from "./lib/gif.ts";

/** VBlanks per second: 16.78 MHz over 280,896 cycles a frame. */
const REFRESH_RATE = 16_777_216 / 280_896;

export interface Step {
  frames: number;
  keys: KeyName[];
}

export function parseScript(script: string): Step[] {
  return script
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => {
      const [frames, keys = "-"] = step.split(":");
      const names = keys === "-" ? [] : (keys.split("+") as KeyName[]);
      for (const name of names) if (!(name in KEY)) throw new Error(`unknown key ${name}`);
      return { frames: Number(frames), keys: names };
    });
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where runtime/gba/src/video.rs shows a screen: scaled up by an exact whole factor, or centered 1:1. */
export function screenRect(width: number, height: number): Rect {
  const exact = (scale: number, length: number) => {
    const step = Math.floor(256 / scale);
    return (scale - 1) * step + (length - 1) * (256 - scale * step) < 256;
  };
  width = Math.min(width, SCREEN_WIDTH);
  height = Math.min(height, SCREEN_HEIGHT);
  for (let scale = Math.min(Math.floor(SCREEN_WIDTH / width), Math.floor(SCREEN_HEIGHT / height)); scale >= 2; scale--)
    if (exact(scale, width) && exact(scale, height))
      return {
        x: Math.floor((SCREEN_WIDTH - width * scale) / 2),
        y: Math.floor((SCREEN_HEIGHT - height * scale) / 2),
        width: width * scale,
        height: height * scale,
      };
  return { x: Math.floor((SCREEN_WIDTH - width) / 2) & ~3, y: Math.floor((SCREEN_HEIGHT - height) / 2), width, height };
}

/** Copies a rectangle out of an RGBA8888 display frame. */
export function crop(frame: Uint8Array, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * SCREEN_WIDTH + rect.x) * 4;
    out.set(frame.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return out;
}

if (import.meta.main) {
  const args = Object.fromEntries(
    process.argv.slice(3).map((arg) => {
      const [key, ...value] = arg.replace(/^--/, "").split("=");
      return [key!, value.join("=") || "true"];
    }),
  );
  const rom = process.argv[2];
  if (!rom)
    throw new Error(
      "usage: bun tools/run.ts <rom> [--frames=N] [--script=...] [--shot=file] [--shots=dir] [--wav=file] [--gif=file]",
    );
  const gba = await Gba.open(resolve(rom));
  gba.recordAudio = !!args.wav;
  const steps = args.script ? parseScript(args.script) : [{ frames: Number(args.frames ?? 120), keys: [] }];
  if (args.shots) mkdirSync(args.shots, { recursive: true });
  const gifSkip = Number(args["gif-skip"] ?? 0),
    gifStep = Number(args["gif-step"] ?? 2);
  const gifFrames: Uint8Array[] = [];
  let vblanks = 0;
  steps.forEach((step, index) => {
    gba.setKeys(step.keys);
    if (!args.gif) gba.run(step.frames);
    else
      for (let i = 0; i < step.frames; i++) {
        gba.run(1);
        vblanks++;
        if (vblanks > gifSkip && (vblanks - gifSkip) % gifStep === 0) gifFrames.push(gba.frame());
      }
    if (args.shots) gba.screenshot(resolve(args.shots, `${String(index).padStart(3, "0")}.png`));
  });
  if (args.shot) gba.screenshot(resolve(args.shot));
  if (args.wav) gba.writeWav(resolve(args.wav));
  if (args.gif) {
    const [, w, h] = gba.logText.match(/screen (\d+)x(\d+)/) ?? [];
    const rect =
      args["gif-full"] || !w
        ? { x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT }
        : screenRect(Number(w), Number(h));
    const frames: GifFrame[] = gifFrames.map((frame) => ({
      rgba: crop(frame, rect),
      duration: gifStep / REFRESH_RATE,
    }));
    writeFileSync(resolve(args.gif), encodeGif(frames, rect.width, rect.height, Number(args["gif-scale"] ?? 2)));
  }
  process.stdout.write(gba.logText);
  gba.close();
}
