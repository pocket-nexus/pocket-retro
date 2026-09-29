/**
 * Moves hot SDK functions into IWRAM as ARM code.
 *
 * A function whose doc comment carries `@iwram` is placed in its own
 * `.iwram.*` section with `#[instruction_set(arm::a32)]`: code in IWRAM runs
 * from a 32-bit bus without wait states, where ARM instructions execute at
 * one per cycle. IWRAM is small (see runtime/gba/gba.ld), so the tag belongs
 * on inner loops only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Names of functions tagged `@iwram` in the TypeScript files of a directory. */
export function iwramFunctions(directory: string): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(directory, { recursive: true }) as string[]) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(resolve(directory, file), "utf8");
    for (const match of source.matchAll(
      /\/\*\*(?:(?!\*\/)[\s\S])*@iwram(?:(?!\*\/)[\s\S])*\*\/\s*(?:export\s+)?function\s+(\w+)/g,
    )) {
      names.add(match[1]!);
    }
  }
  return names;
}

/** Adds IWRAM placement to generated model functions whose source name is tagged. */
export function placeInIwram(rust: string, names: Set<string>): { rust: string; placed: string[] } {
  rust = rust.replace(/\n[ \t]*\n([ \t]*#\[)/g, "\n$1");
  const placed: string[] = [];
  const output = rust.replace(
    /^(\s*)fn ((?:render_)?fn_\d+|pure_\d+)\(([^\n]*)\n(\s*)(self\.depth|depth)\.enter\("(\w+)"\);/gm,
    (whole, indent: string, rustName: string, rest: string, inner: string, receiver: string, source: string) => {
      if (!names.has(source)) return whole;
      placed.push(`${source} (${rustName})`);
      return `${indent}#[link_section = ".iwram.${rustName}"]\n${indent}#[instruction_set(arm::a32)]\n${indent}#[inline(never)]\n${indent}fn ${rustName}(${rest}\n${inner}${receiver}.enter("${source}");`;
    },
  );
  return { rust: output, placed };
}

/**
 * Drops the closure MicroTS wraps around each model function body to pair
 * depth.enter() with depth.leave(). Both are empty outside debug builds, and
 * the closure would not follow its function into ARM code: LLVM cannot
 * inline Thumb code into an ARM function.
 */
export function flattenFunctions(rust: string): string {
  return rust.replace(
    /^([ \t]*)((?:#\[[^\n]*\]\n\s*)*)fn ((?:render_)?fn_\d+|pure_\d+)\(([^\n]*)\{\n([ \t]*)(?:self\.depth|depth)\.enter\("\w+"\);\n\5let result = \(\|\| \{\n([\s\S]*?)\n\5\}\)\(\);\n\5(?:self\.depth|depth)\.leave\(\);\n\5result\n/gm,
    (_whole, indent: string, attributes: string, name: string, rest: string, _inner: string, body: string) =>
      `${indent}${attributes}fn ${name}(${rest}{\n${body}\n`,
  );
}
