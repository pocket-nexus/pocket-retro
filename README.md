# Pocket Retro

Run [Pyxel](https://github.com/kitao/pyxel) games on a Game Boy Advance.

A Pyxel game is ported by hand (or by a coding agent) from Python to
TypeScript against the Pyxel SDK in `sdk/`. PocketJS
[MicroTS](https://github.com/pocket-nexus/pocketjs) compiles the game and the
SDK ahead of time to Rust, which is linked with a small bare-metal GBA host
into a ROM. Nothing interprets Python or JavaScript on the console. The game's
`.pyxres` and `.pyxpal` files are baked into the cartridge as they are.

| Game                                         | Source example          |
| -------------------------------------------- | ----------------------- |
| [Hello Retro](games/hello/game.ts)           | a first test of the SDK |
| [Pyxel Jump](games/jump/game.ts)             | `02_jump_game.py`       |
| [Snake!](games/snake/game.ts)                | `07_snake.py`           |
| [Pyxel Shooter](games/shooter/game.ts)       | `09_shooter.py`         |
| [Pyxel Platformer](games/platformer/game.ts) | `10_platformer.py`      |

A game is three functions against the SDK's namespaces:

```ts
import { system, screen, input, sound, color } from "retro";

let x = 72;

export function setup(): void {
  system.init(160, 120);
}

export function update(): void {
  if (input.btn(input.key.LEFT)) x -= 2;
  if (input.btnp(input.key.SPACE)) sound.play(3, 0);
}

export function draw(): void {
  screen.cls(color.NAVY);
  screen.rect(x, 60, 16, 16, color.YELLOW);
}
```

## Build a ROM

Prerequisites are listed in [AGENTS.md](AGENTS.md#prerequisites): Bun, a
PocketJS checkout next to this repository, a Rust nightly with `rust-src`, and
CMake/Ninja for the headless emulator used by the tools.

```sh
bun install
bun run emu:setup                         # once: builds the headless mGBA
bun tools/build.ts games/jump             # → dist/jump.gba
bun tools/run.ts dist/jump.gba --frames=300 --shot=jump.png
```

`dist/<game>.gba` runs in any GBA emulator and on hardware from a flash cart.

## Port a game

Porting is an agent task with a written procedure: the
[`port-pyxel-game` skill](skills/port-pyxel-game/SKILL.md) walks through
surveying a Pyxel game, translating it, baking its resources, and checking and
profiling the ROM, and its [reference](skills/port-pyxel-game/reference.md)
maps Pyxel's API onto the SDK. Agents that read `AGENTS.md` or skills from
`.claude/skills` pick both up in this repository; point other agents at the
skill file.

## Layout

- `sdk/` — the Pyxel API in TypeScript (drawing, tilemaps, input, sound)
- `runtime/gba/` — the Rust host: display, keypad, sound mixer, memory
- `games/` — ported games
- `tools/` — build, headless run, profiler, resource baking
- `skills/` — the porting skill

See [AGENTS.md](AGENTS.md) for architecture, rules and performance notes.
