/**
 * The SDK's MML parser and classic sound conversion, run directly under Bun.
 * Expected values come from pyxel-core 2.9.9's mml_parser.rs and sound.rs.
 */
import { expect, test } from "bun:test";
import {
  classicCommands,
  CMD_NOTE,
  CMD_QUANTIZE,
  CMD_REPEAT_END,
  CMD_REPEAT_START,
  CMD_REST,
  CMD_TEMPO,
  CMD_VOLUME,
  commandSize,
  mmlError,
  parseMml,
} from "../sdk/sound.ts";

/** Commands as [op, ...args] lists. */
function split(commands: number[]): number[][] {
  const out: number[][] = [];
  for (let at = 0; at < commands.length;) {
    const size = commandSize(commands[at]!, commands[at + 3] ?? 0);
    out.push(commands.slice(at, at + size));
    at += size;
  }
  return out;
}

/** Notes as [midi, ticks, gate%] with the gate in effect, repeats expanded. */
function notes(commands: number[]): number[][] {
  const out: number[][] = [];
  const list = split(commands);
  let gate = 100;
  const stack: { at: number; count: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const [op, a, b] = list[i]!;
    if (op === CMD_QUANTIZE) gate = a!;
    else if (op === CMD_NOTE) out.push([a!, b!, gate]);
    else if (op === CMD_REST) out.push([-1, a!, gate]);
    else if (op === CMD_REPEAT_START) stack.push({ at: i, count: 0 });
    else if (op === CMD_REPEAT_END) {
      const top = stack.at(-1)!;
      if (++top.count < a!) i = top.at;
      else stack.pop();
    }
  }
  return out;
}

const ticks = (commands: number[]) => notes(commands).reduce((sum, [, t]) => sum + t!, 0);

test("a lone note gets every default first", () => {
  const list = split(parseMml("C"));
  expect(list.length).toBe(11);
  expect(list[0]).toEqual([CMD_TEMPO, 18643]);
  expect(list.at(-2)).toEqual([CMD_QUANTIZE, 80]);
  expect(list.at(-1)).toEqual([CMD_NOTE, 60, 48]);
});

test("tempo, lengths and dots", () => {
  expect(split(parseMml("T128 C"))[0]).toEqual([CMD_TEMPO, 17478]);
  expect(split(parseMml("T150 C"))[0]).toEqual([CMD_TEMPO, 14915]);
  expect(notes(parseMml("L16 G. C4. C4.. C8&4."))).toEqual([
    [67, 18, 80],
    [60, 72, 80],
    [60, 84, 80],
    [60, 24 + 72, 80],
  ]);
  expect(parseMml("C192.")).toEqual([]);
  expect(mmlError).toContain("odd note length");
});

test("ties merge notes and slurs keep the gate open", () => {
  expect(notes(parseMml("Q50 C4& C4 D"))).toEqual([
    [60, 96, 100],
    [62, 48, 50],
  ]);
  expect(notes(parseMml("Q50 C4&4 D"))).toEqual([
    [60, 96, 50],
    [62, 48, 50],
  ]);
  expect(notes(parseMml("C&D"))).toEqual([
    [60, 48, 100],
    [62, 48, 80],
  ]);
  expect(parseMml("C& R")).toEqual([]);
});

test("defaults can land inside a loop", () => {
  const list = split(parseMml("[C V50 D]2"));
  const firstVolume = list.findIndex(([op]) => op === CMD_VOLUME);
  expect(firstVolume).toBeGreaterThan(list.findIndex(([op]) => op === CMD_REPEAT_START));
  expect(list[firstVolume]).toEqual([CMD_VOLUME, 3225]);
});

test("octaves and accidentals", () => {
  expect(notes(parseMml("O4 A >C <<B- E+ Q100")).map(([m]) => m)).toEqual([69, 72, 58, 53]);
  expect(parseMml("O9 >C")).toEqual([]);
});

test("the shooter's tunes have the lengths Pyxel gives them", () => {
  const a2 = "D8.C8.D4G8AB->CD C8.<F2R FFGA B-8.A8.B-4.GGAB-";
  const a3 = "RR>CC<B->C8 D8.D8CD8.<";
  const title = [
    "T128 Q96 @2 @ENV1{127,6,96} O4 L16 @VIB1{36,18,25} K-2" + a2 + a3,
    "T128 Q90 @0 V96 O3 L16" + "FFR4 FFR4 <F4> E-E-R4 E-E-R4 <E-4> D-D-R4 D-D-R4 <D-4> E-E-R4 E-E-R4 EEE8",
    "T128 Q50 @3 L16 @ENV1{48,8,0} @ENV2{127,6,0}" +
      "[@ENV1 O7 FFR4 FFR4 @ENV2 O3 G4]3 @ENV1 O7 FFR4 FFR4 FF @ENV2 O3 G8",
  ];
  for (const code of title) {
    const commands = parseMml(code);
    expect(mmlError).toBe("");
    expect(ticks(commands)).toBe(768);
  }
  const b2 = "<B-8.A8.B-4>D8DDGB- A8.<A2R AA>CF G8.F8.G4.E-E-FG";
  const c2 = "[<G.R32>DG]4 [<F.R32>CF]4 [<E-.R32B->E-]4";
  const game = [
    "T150 Q96 @1 @ENV1{127,12,64} O4 L16" + a2 + a3 + a2 + "RR>CC<B->C8 D8.D8C<A8G&1",
    "T150 Q96 @1 @ENV1{112,12,56} @ENV2{64,8,0} O4 L16 @ENV1 " +
      b2 +
      "RRAAGA8 A8.A8GA8." +
      b2 +
      "RRAAGA8 A8.A8GD8 Q100 C&4.<B4. @3 O7 @ENV2 FFFF",
    "T150 Q100 @0 V96 O3 L16 @GLI1{400,4} @GLI0 " +
      c2 +
      "Q80 <F8FF>F<F8 F+8RF+8>F+<F+8.>" +
      c2 +
      "Q80 @GLI0 <F8FF>F<F8F+8RF+8>F+<F+8 Q100 G8R>DG<[G.R32>DG<]2 @GLI1 Q50 >>CC<F8>",
  ];
  for (const code of game) {
    const commands = parseMml(code);
    expect(mmlError).toBe("");
    expect(ticks(commands)).toBe(1728);
  }
});

test("classic sounds become notes with glides and fades", () => {
  // sounds[0].set("a3a2c1a1", "p", "7", "s", 5) from the shooter.
  const shot = notes(classicCommands([45, 33, 12, 21], [2], [7], [1], 5));
  expect(shot).toEqual([
    [81, 5, 100],
    [69, 5, 100],
    [48, 5, 100],
    [57, 5, 100],
  ]);
  const noise = split(classicCommands([45, 33, 24, 24], [3], [7, 7, 4, 2], [1], 10));
  expect(noise.filter(([op]) => op === CMD_NOTE).map(([, m]) => m)).toEqual([105, 93, 84, 84]);
  expect(split(classicCommands([0], [0], [7], [3], 7))).toContainEqual([8, 1, 127, 1, 7, 0]);
});
