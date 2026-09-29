#!/usr/bin/env bun
/**
 * Builds the headless emulator used by tests: mGBA as a static library plus
 * tools/emu/shim.c, linked into .cache/emu/libpocketemu.<ext>.
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const MGBA_TAG = "0.10.5";
const root = resolve(import.meta.dir, "../..");
const cache = resolve(root, ".cache");
const source = resolve(cache, "mgba-src");
const build = resolve(cache, "mgba-static");
export const EMU_LIBRARY = resolve(
  cache,
  "emu",
  process.platform === "darwin" ? "libpocketemu.dylib" : "libpocketemu.so",
);

async function run(command: string[], cwd = root) {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`command failed: ${command.join(" ")}`);
}

export async function setupEmulator(force = false): Promise<string> {
  if (existsSync(EMU_LIBRARY) && !force) return EMU_LIBRARY;
  mkdirSync(resolve(cache, "emu"), { recursive: true });
  if (!existsSync(source)) {
    await run(["git", "clone", "--depth", "1", "--branch", MGBA_TAG, "https://github.com/mgba-emu/mgba.git", source]);
  }
  // Only the GBA core, without frontends, codecs or scripting.
  const off = [
    "BUILD_QT",
    "BUILD_SDL",
    "BUILD_SHARED",
    "BUILD_LIBRETRO",
    "BUILD_PERF",
    "BUILD_TEST",
    "BUILD_SUITE",
    "BUILD_CINEMA",
    "BUILD_ROM_TEST",
    "USE_FFMPEG",
    "USE_PNG",
    "USE_LIBZIP",
    "USE_MINIZIP",
    "USE_ZLIB",
    "USE_SQLITE3",
    "USE_ELF",
    "USE_LUA",
    "USE_EDITLINE",
    "USE_EPOXY",
    "USE_DISCORD_RPC",
    "USE_GDB_STUB",
    "USE_DEBUGGERS",
    "ENABLE_SCRIPTING",
    "M_CORE_GB",
    "BUILD_GL",
    "BUILD_GLES2",
    "BUILD_GLES3",
  ];
  await run([
    "cmake",
    "-S",
    source,
    "-B",
    build,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
    "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
    "-DBUILD_STATIC=ON",
    ...off.map((name) => `-D${name}=OFF`),
  ]);
  await run(["cmake", "--build", build, "--target", "mgba"]);
  const libraries = process.platform === "darwin" ? ["-framework", "CoreFoundation"] : ["-lm", "-lpthread"];
  await run([
    process.env.CC ?? "cc",
    "-O2",
    "-shared",
    "-fPIC",
    "-o",
    EMU_LIBRARY,
    resolve(import.meta.dir, "shim.c"),
    `-I${resolve(source, "include")}`,
    `-I${resolve(build, "include")}`,
    resolve(build, "libmgba.a"),
    ...libraries,
  ]);
  return EMU_LIBRARY;
}

if (import.meta.main) console.log(await setupEmulator(process.argv.includes("--force")));
