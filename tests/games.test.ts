/**
 * Builds every game in games/ and plays it headless with scripted input:
 * the ROM must not panic, must draw something, and must keep up with its
 * frame rate after the first second.
 *
 *   bun test tests/games.test.ts          (needs `bun run emu:setup` once)
 */
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildGame } from "../tools/build.ts";
import { Gba } from "../tools/emu/mgba.ts";
import { parseScript } from "../tools/run.ts";

const ROOT = resolve(import.meta.dir, "..");
/** Input for each game: start it, then move and press its buttons. */
const SCRIPTS: Record<string, string> = {
  hello: "300:-",
  jump: "60:- 60:RIGHT 30:LEFT 150:-",
  snake: "30:- 20:UP 20:LEFT 20:DOWN 200:- 5:START 30:-",
  shooter: "60:- 5:START 60:- 20:A 5:- 20:A 60:LEFT 60:RIGHT+A 60:-",
  platformer: "60:- 120:RIGHT 10:RIGHT+A 90:RIGHT 30:LEFT",
};

const games = readdirSync(resolve(ROOT, "games"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(ROOT, "games", entry.name, "pyxel.json")))
  .map((entry) => entry.name);

test("every game has a script", () => {
  expect(games.filter((name) => !SCRIPTS[name])).toEqual([]);
});

for (const name of games) {
  test(`${name} builds and plays`, async () => {
    const { rom } = await buildGame(resolve(ROOT, "games", name), { out: resolve(ROOT, "dist") });
    const gba = await Gba.open(rom);
    try {
      for (const step of parseScript(SCRIPTS[name] ?? "300:-")) {
        gba.setKeys(step.keys);
        gba.run(step.frames);
      }
      const log = gba.logText;
      expect(log).not.toContain("panic");
      // Some pixel differs from the first: the game drew something.
      const frame = gba.frame();
      let drawn = false;
      for (let i = 4; i < frame.length && !drawn; i += 4)
        drawn = frame[i] !== frame[0] || frame[i + 1] !== frame[1] || frame[i + 2] !== frame[2];
      expect(drawn).toBe(true);
      // Stats lines after the first report no late frames.
      const late = [...log.matchAll(/stats frames=(\d+) .* late=(\d+)/g)]
        .filter((match) => Number(match[1]) > 60)
        .map((match) => Number(match[2]));
      expect(late.length).toBeGreaterThan(0);
      expect(late.filter((count) => count > 0)).toEqual([]);
    } finally {
      gba.close();
    }
  }, 300_000);
}
