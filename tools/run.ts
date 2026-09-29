#!/usr/bin/env bun
/**
 * Runs a ROM headless in mGBA and records what it shows and prints.
 *
 *   bun tools/run.ts dist/hello.gba --frames=300 --shot=out.png
 *   bun tools/run.ts dist/jump.gba --script="60:A 4:- 30:RIGHT" --shot=out.png --wav=out.wav
 *
 * A script is a list of `frames:KEYS` steps run in order; KEYS joins key
 * names with `+` (A, B, SELECT, START, RIGHT, LEFT, UP, DOWN, R, L) and `-`
 * releases every key. `--shots=<directory>` saves a PNG after each step.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Gba, KEY, type KeyName } from "./emu/mgba.ts";

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
      "usage: bun tools/run.ts <rom> [--frames=N] [--script=...] [--shot=file] [--shots=dir] [--wav=file]",
    );
  const gba = await Gba.open(resolve(rom));
  gba.recordAudio = !!args.wav;
  const steps = args.script ? parseScript(args.script) : [{ frames: Number(args.frames ?? 120), keys: [] }];
  if (args.shots) mkdirSync(args.shots, { recursive: true });
  steps.forEach((step, index) => {
    gba.setKeys(step.keys);
    gba.run(step.frames);
    if (args.shots) gba.screenshot(resolve(args.shots, `${String(index).padStart(3, "0")}.png`));
  });
  if (args.shot) gba.screenshot(resolve(args.shot));
  if (args.wav) gba.writeWav(resolve(args.wav));
  process.stdout.write(gba.logText);
  gba.close();
}
