# Pocket Pyxel — agent instructions

Pocket Pyxel runs [Pyxel](https://github.com/kitao/pyxel) games on a Game Boy
Advance. Games are ported from Python to TypeScript by an agent, compiled to
Rust by PocketJS **MicroTS** (compiled-model mode) and linked into a
bare-metal GBA ROM. There is no JavaScript engine and no Python on the device.

## Layout

| Path         | Contents                                                                          |
| ------------ | --------------------------------------------------------------------------------- |
| `tools/emu/` | Headless mGBA harness: `setup.ts` builds `libmgba` + `shim.c`, `mgba.ts` binds it |
| `tools/git/` | Git hooks run by lefthook                                                         |
| `tools/lib/` | Shared build helpers (PNG codec)                                                  |

## Prerequisites

- Bun, and `bun install` in this repository (installs the lefthook hooks).
- PocketJS checkout at `../pocketjs` (override with `POCKETJS_ROOT`) on the
  local branch `feat/microts-game-subset`, with `bun install` run there. The
  branch carries the MicroTS extensions this project needs; it is not pushed.
- Rust: `rustup toolchain install nightly-2026-07-01 --component rust-src`
  (the GBA target `thumbv4t-none-eabi` is built with `-Z build-std`).
- CMake, Ninja and a C compiler for the headless emulator (`bun run emu:setup`).

## Rules

- **Conventional Commits**: `type(scope): summary`. The `commit-msg` hook
  rejects other headers. Commit each finished task on its own.
- lefthook formats staged files on every commit (prettier, rustfmt,
  clang-format) and re-stages them. Do not bypass it with `--no-verify`.
- Changes to PocketJS itself belong in `../pocketjs` on
  `feat/microts-game-subset`, committed there, not in this repository.
- Generated output (`build/`, `dist/`, `gen/`, `.cache/`) is ignored; never
  edit it by hand.
