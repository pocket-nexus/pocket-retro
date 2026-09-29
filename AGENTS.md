# Pocket Retro — agent instructions

Pocket Retro runs [Pyxel](https://github.com/kitao/pyxel) games on a Game Boy
Advance. Games are ported from Python to TypeScript against the Pyxel SDK in
`sdk/`, compiled to Rust by PocketJS **MicroTS** (compiled-model mode) and
linked with the GBA host in `runtime/gba` into a bare-metal ROM. There is no
JavaScript engine and no Python on the device.

## Layout

| Path            | Contents                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `sdk/`          | The Pyxel API in TypeScript. Games import its namespaces from `"retro"` (`sdk/retro.ts`)          |
| `sdk/api/`      | One public namespace per file (`screen`, `input`, `sound`, …); `retro.ts` re-exports them         |
| `sdk/assets.ts` | Stub of the per-game asset module that `tools/lib/assets.ts` generates at build time              |
| `runtime/gba/`  | Rust host: boot, IRQ, Mode 4 display, keypad, 4-voice mixer, heaps, `Game` trait, linker script   |
| `games/<name>/` | Ported games: `game.ts` (setup, update, draw), `retro.json` manifest, `assets/`                   |
| `tools/`        | `build.ts` (game → ROM), `run.ts` (headless play, screenshots, WAV), `profile.ts` (cycle profile) |
| `tools/lib/`    | `.pyxres`/`.pyxpal` reader, asset baker, ROM packer, IWRAM placement, PNG and zip codecs          |
| `tools/emu/`    | Headless mGBA: `setup.ts` builds `libmgba` + `shim.c`, `mgba.ts` binds it                         |
| `skills/`       | Agent skills; `port-pyxel-game` is the procedure for porting a game (`.claude/skills` links here) |

To port a game, follow `skills/port-pyxel-game/SKILL.md`.

Generated output: `build/<game>/` (baked assets, `gen/app_model.rs`, the game
crate), `dist/<game>.gba` and `.elf`, `.cache/` (mGBA, cargo target).

## Prerequisites

- Bun, and `bun install` in this repository (installs the lefthook hooks).
- PocketJS checkout at `../pocketjs` (override with `POCKETJS_ROOT`) on the
  local branch `feat/microts-game-subset`, with `bun install` run there. The
  branch carries the MicroTS extensions this project needs; it is not pushed.
- Rust: `rustup toolchain install nightly-2026-07-01 --component rust-src`
  (`thumbv4t-none-eabi` is built with `-Z build-std=core,alloc`).
- CMake, Ninja and a C compiler for the headless emulator (`bun run emu:setup`).

## Commands

```sh
bun tools/build.ts games/jump            # → dist/jump.gba (add --no-inline for profiling builds)
bun tools/run.ts dist/jump.gba --script="120:- 30:RIGHT 30:A" --shot=out.png --wav=out.wav
bun tools/profile.ts games/jump          # cycle-sampled profile of the last build
bun tools/profile.ts games/jump --script="60:RIGHT" --within=blt   # plus hot addresses inside blt
```

At boot the ROM logs `screen WxH in IWRAM` (or `EWRAM`). Then, every `fps`
game frames (one second), it prints
`stats frames=… game=avg/max present=… late=… heap=… iwram=… stack=…`
through the mGBA debug console; `tools/run.ts` shows both. `frames` counts
game frames, while `--script` steps and `profile --skip` count VBlanks
(60 a second). `game` is CPU cycles per frame for update + draw + sequencer,
including the mixer interrupt; `present` is the copy of the screen to VRAM.
Both must fit in 60 / fps VBlanks of 280,896 cycles (561,792 at 30 fps), less
a little host work: at 30 fps frames start to run late when `game` +
`present` passes about 520,000. `late` counts frames that missed their VBlank;
`iwram=used/size` is the IWRAM heap after code.

The emulator is deterministic, so a fixed `--script` gives repeatable
numbers: compare optimizations by the mean of `game` over the same script,
not by one window. Profile a `--no-inline` build, or small functions merge
into their callers; percentages are of all time, idle ("halted in BIOS") and
`present` included. Read hot addresses from `--within` against
`llvm-objdump -d --triple=armv4t-none-eabi dist/<game>.elf` (the nightly
toolchain ships `llvm-objdump` under `lib/rustlib/*/bin`). Screenshots of a
ROM with late frames can be torn: the page flip happened mid-display.

## Architecture rules

- **The SDK is TypeScript.** Pyxel semantics (drawing, input, sequencer,
  resources) live in `sdk/`. The public API is the namespaces of `sdk/api/`
  (`import { screen, input } from "retro"; screen.cls(0)`): thin wrappers
  over the internal modules (`gfx.ts`, `audio.ts`, `input.ts`, …), resolved
  at compile time, so namespaces cost nothing at run time. Add public
  functions to the namespace they belong to; constants keep Pyxel's upper
  case without the prefix the namespace replaces (`color.NAVY`,
  `input.key.LEFT`). `runtime/gba` only does what hardware does: present
  the indexed screen and palette, sample keys, synthesize the voices the
  sequencer requests, pace frames. Do not move SDK logic into Rust.
- The host reads SDK state through exported fields of `sdk/hw.ts`, which
  MicroTS turns into `hw_<field>()` accessors. The generated root module
  (`tools/build.ts`) calls `boot`, then `frame(keys, audioTicks)` per frame.
- Resources are baked at build time (`retro.json` → `tools/lib/assets.ts`):
  image banks and tilemaps become embedded cartridge data, read in place.
  A bank is copied to RAM on its first write; tilemap writes go to an overlay.
- Rasterization follows pyxel-core `canvas.rs` but uses integer and fixed
  point math: the GBA has no FPU and soft float costs 100+ cycles per op.
- Sound follows pyxel-core 2.9: `sdk/sound.ts` compiles `Sound.set` data and
  MML into the command lists Pyxel plays, `sdk/audio.ts` runs them per
  channel on Pyxel's 1,789,773 Hz clock and emits one voice record per
  channel per mixer tick (76 samples, 1/239 s), and `runtime/gba/src/audio.rs`
  synthesizes the records. `tests/sound.test.ts` checks the parser; when
  changing playback, compare a tune with Pyxel's `pyxel.musics[n].save()`.
- Performance: hot inner loops carry a `/** @iwram */` doc tag, which places
  the generated function in IWRAM as ARM code (`tools/lib/iwram.ts`). ARM
  code cannot inline Thumb code (nor generic Rust helpers, iterators or
  trait calls), so a tagged function writes small helpers out inline or calls
  other tagged functions.
- IWRAM (32 KiB) is shared, in this order, by tagged code, the model struct
  (one field per module-level `let` of the SDK and the game, 12 bytes per
  array), arrays of at most 512 bytes created with the model (up to 1.5 KiB
  in all; arrays created later, as in `setup()`, go to EWRAM), and last the
  screen, moved there after boot if it still fits. A screen in EWRAM makes
  `present` and every draw about a third slower; screens over about 20 KB
  (200 x 150) never fit. `tests/games.test.ts` requires screens up to
  160 x 120 to stay in IWRAM: run it after any SDK change, since a few
  hundred bytes of new code or fields can push Pyxel Jump's screen out.
- Pixel spans go through MicroTS array builtins, which compile to loops
  without per-element bounds checks: `copyRange` (with a skipped color for
  color keys), `fillRange`, and `copyRect`/`fillRect` for small rectangles
  such as 8 x 8 tiles. Long rows are copied faster by `copyRange` per row.
  Per-pixel `a[i]` reads and writes each check bounds.
- Tilemap drawing classifies each 8 x 8 cell of an image bank by color:
  cells of the transparent color are skipped and single-color cells filled.
  Any write to a bank resets its cells, so games that draw into a bank every
  frame lose this.
- Drawing to the screen without dither has fast paths, `pal()` mappings
  included. Dither, drawing into image banks, flipped `bltm` and rotated or
  scaled `blt` go pixel by pixel through clip, dither and palette checks.
- Strings cost allocations: each string passed to a function and each `+`
  copies (1,000 or more cycles each), and `codePoints()` allocates its
  result. A template string builds its result in one step. Keep per-frame
  text to what the game shows.
- Float math is emulated: basic operations cost 50-300 cycles and libm
  functions (`sqrt`, `atan2`, `pow`, `exp`, `log`) thousands. The SDK's `sin`
  and `cos` use f32 polynomials instead of libm.
- MicroTS value semantics: arrays and structs passed as arguments, assigned to
  locals or iterated with `for…of` are copied. In hot code pass indices, not
  arrays, and write through paths (`items[i].x += 1`). Reading `rows[i][j]`
  or `len(rows[i])` does not copy `rows[i]`; a loop that only reads
  `rows[i]` with `i` fixed and calls no other TypeScript function borrows
  the row once.

## Rules

- **Conventional Commits**: `type(scope): summary`. The `commit-msg` hook
  rejects other headers. Scopes: `sdk`, `runtime`, `tools`, `games`, `skill`,
  `docs`. Commit each finished task on its own.
- lefthook formats staged files on every commit (prettier, rustfmt,
  clang-format) and re-stages them. Do not bypass it with `--no-verify`.
- Changes to PocketJS itself belong in `../pocketjs` on
  `feat/microts-game-subset`, committed there, not in this repository.
- Generated output (`build/`, `dist/`, `gen/`, `.cache/`) is ignored; never
  edit it by hand. `runtime/gba/Cargo.lock` pins the game crates' dependencies.
- Ported games keep their original author and license in a comment at the
  top of `game.ts`; Pyxel's examples are MIT.
