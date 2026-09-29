# Pocket Pyxel — agent instructions

Pocket Pyxel runs [Pyxel](https://github.com/kitao/pyxel) games on a Game Boy
Advance. Games are ported from Python to TypeScript against the Pyxel SDK in
`sdk/`, compiled to Rust by PocketJS **MicroTS** (compiled-model mode) and
linked with the GBA host in `runtime/gba` into a bare-metal ROM. There is no
JavaScript engine and no Python on the device.

## Layout

| Path            | Contents                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `sdk/`          | The Pyxel API in TypeScript. Games import it as `"pyxel"` (`pyxel.ts` is the only public module)  |
| `sdk/assets.ts` | Stub of the per-game asset module that `tools/lib/assets.ts` generates at build time              |
| `runtime/gba/`  | Rust host: boot, IRQ, Mode 4 display, keypad, 4-voice mixer, heaps, `Game` trait, linker script   |
| `games/<name>/` | Ported games: `game.ts` (setup, update, draw), `pyxel.json` manifest, `assets/`                   |
| `tools/`        | `build.ts` (game → ROM), `run.ts` (headless play, screenshots, WAV), `profile.ts` (cycle profile) |
| `tools/lib/`    | `.pyxres`/`.pyxpal` reader, asset baker, ROM packer, IWRAM placement, PNG and zip codecs          |
| `tools/emu/`    | Headless mGBA: `setup.ts` builds `libmgba` + `shim.c`, `mgba.ts` binds it                         |

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
```

The ROM prints `stats frames=… game=avg/max present=… late=… heap=… iwram=… stack=…`
through the mGBA debug console once per second; `tools/run.ts` shows it.
`game` is CPU cycles per frame for update + draw + sequencer (budget: 280,896
per VBlank, so 561,792 at 30 fps); `late` counts frames that missed their VBlank.

## Architecture rules

- **The SDK is TypeScript.** Pyxel semantics (drawing, input, sequencer,
  resources) live in `sdk/`. `runtime/gba` only does what hardware does:
  present the indexed screen and palette, sample keys, synthesize the voices
  the sequencer requests, pace frames. Do not move SDK logic into Rust.
- The host reads SDK state through exported fields of `sdk/hw.ts`, which
  MicroTS turns into `hw_<field>()` accessors. The generated root module
  (`tools/build.ts`) calls `boot`, then `frame(keys, audioTicks)` per frame.
- Resources are baked at build time (`pyxel.json` → `tools/lib/assets.ts`):
  image banks and tilemaps become embedded cartridge data, read in place.
  A bank is copied to RAM on its first write; tilemap writes go to an overlay.
- Rasterization follows pyxel-core `canvas.rs` but uses integer and fixed
  point math: the GBA has no FPU and soft float costs 100+ cycles per op.
- Performance: hot inner loops carry a `/** @iwram */` doc tag, which places
  the generated function in IWRAM as ARM code (`tools/lib/iwram.ts`). ARM
  code cannot inline Thumb code, so tagged functions should avoid calling
  small helpers; IWRAM holds these functions, the screen (moved there when it
  fits), the model struct and small arrays. Check `iwram=` in the stats line.
- MicroTS value semantics: arrays and structs passed as arguments, assigned to
  locals or iterated with `for…of` are copied. In hot code pass indices, not
  arrays, and write through paths (`items[i].x += 1`).

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
