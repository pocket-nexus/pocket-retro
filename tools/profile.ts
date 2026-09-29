#!/usr/bin/env bun
/**
 * Statistical profile of a ROM in the headless emulator: samples the
 * executing instruction every N CPU cycles and attributes samples to
 * functions from the ELF symbol table. Generated model functions (fn_12,
 * render_fn_12, pure_12) are labeled with their TypeScript names.
 *
 *   bun tools/profile.ts games/jump [--skip=120] [--samples=20000] [--interval=211] [--script=...]
 *
 * `--within=<label>` also lists the hottest addresses inside functions whose
 * label contains <label>, to read against a disassembly of the ELF.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Gba } from "./emu/mgba.ts";
import { parseScript } from "./run.ts";

const ROOT = resolve(import.meta.dir, "..");
const NM = resolve(
  process.env.HOME!,
  ".rustup/toolchains/nightly-2026-07-01-aarch64-apple-darwin/lib/rustlib/aarch64-apple-darwin/bin/llvm-nm",
);

interface Symbol {
  address: number;
  size: number;
  name: string;
}

async function symbols(elf: string): Promise<Symbol[]> {
  const child = Bun.spawn([NM, "--demangle", "--print-size", "--defined-only", "--numeric-sort", elf], {
    stdout: "pipe",
  });
  const text = await new Response(child.stdout).text();
  const table = text
    .split("\n")
    .map((line) => line.match(/^([0-9a-f]+)(?: ([0-9a-f]+))? [tTwW] (.+)$/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => ({
      address: Number.parseInt(match[1]!, 16) & ~1,
      size: Number.parseInt(match[2] ?? "0", 16),
      name: match[3]!,
    }));
  // Assembly labels (memset's loops in start.s) have no size: they run to the next symbol.
  table.forEach((symbol, index) => {
    const next = table[index + 1];
    if (symbol.size === 0 && next) symbol.size = next.address - symbol.address;
  });
  return table;
}

/** TypeScript names of generated model functions, written by tools/build.ts. */
function modelNames(table: string): Map<string, string> {
  return new Map(
    existsSync(table) ? Object.entries(JSON.parse(readFileSync(table, "utf8")) as Record<string, string>) : [],
  );
}

if (import.meta.main) {
  const args = Object.fromEntries(
    process.argv.slice(3).map((arg) => {
      const [key, ...value] = arg.replace(/^--/, "").split("=");
      return [key!, value.join("=") || "true"];
    }),
  );
  const game = resolve(process.argv[2] ?? "");
  const name = basename(game);
  const rom = resolve(ROOT, "dist", `${name}.gba`);
  const elf = resolve(ROOT, "dist", `${name}.elf`);
  if (!existsSync(rom)) throw new Error(`${rom} not found; build ${game} first`);
  const table = await symbols(elf);
  const labels = modelNames(resolve(ROOT, "build", name, "gen/functions.json"));
  const gba = await Gba.open(rom);
  gba.run(Number(args.skip ?? 120));
  for (const step of args.script ? parseScript(args.script) : []) {
    gba.setKeys(step.keys);
    gba.run(step.frames);
  }
  const samples = gba.profile(Number(args.samples ?? 20000), Number(args.interval ?? 211));
  gba.close();

  const counts = new Map<string, number>();
  const addresses = new Map<number, number>();
  let symbolIndex = 0;
  const sorted = [...samples].sort((a, b) => a - b);
  for (const address of sorted) {
    let label = "(halted in BIOS)";
    if (address !== 0) {
      while (symbolIndex + 1 < table.length && table[symbolIndex + 1]!.address <= address) symbolIndex++;
      const symbol = table[symbolIndex];
      label =
        symbol && address >= symbol.address && address < symbol.address + Math.max(symbol.size, 1)
          ? symbol.name
          : `0x${address.toString(16)}`;
      const generated = label.match(/((?:render_)?fn_\d+|pure_\d+)$/);
      if (generated && labels.has(generated[1]!)) label = `${labels.get(generated[1]!)} [${generated[1]}]`;
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (args.within && label.includes(args.within)) addresses.set(address, (addresses.get(address) ?? 0) + 1);
  }
  const total = samples.length;
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top ?? 25));
  for (const [label, count] of rows) console.log(`${((count / total) * 100).toFixed(1).padStart(5)}%  ${label}`);
  if (addresses.size) console.log(`\nhottest addresses in ${args.within}:`);
  for (const [address, count] of [...addresses].sort((a, b) => b[1] - a[1]).slice(0, 24))
    console.log(`${((count / total) * 100).toFixed(1).padStart(5)}%  0x${address.toString(16)}`);
}
