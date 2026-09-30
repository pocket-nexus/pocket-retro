---
name: port-pyxel-game
description: Port a Pyxel (Python) game to Pocket Retro so it runs on a Game Boy Advance. Covers surveying the game, translating Python to the namespaced TypeScript Pyxel SDK in sdk/retro.ts, baking .pyxres/.pyxpal/PNG resources, building the ROM, playing it headless with scripted input, and profiling it into the frame budget. Use when asked to port, convert or bring a Pyxel game or example to the GBA or to this repository.
---

# Port a Pyxel game to the GBA

A port is a hand translation of the game's Python into `games/<name>/game.ts`,
written against the `"retro"` module (`sdk/retro.ts`), which groups Pyxel's
API in namespaces: `system`, `screen`, `image`, `tilemap`, `input`, `sound`,
`music`, `math`, `text` and `color` (one file each in `sdk/api/`). MicroTS compiles it
to Rust ahead of time and `tools/build.ts` links it into a GBA ROM: there is
no Python or JavaScript on the device, so the translation must stay inside
the MicroTS subset described below. Do not write an automatic converter and
do not reimplement Pyxel features inside the game: if the SDK lacks
something, add it to `sdk/` (TypeScript) for every game.

Read `AGENTS.md` first. Keep `sdk/api/` open while translating: it is the
authoritative list of what the SDK offers, with Pyxel's names in camelCase
inside each namespace. [reference.md](reference.md) maps Pyxel's API onto it
and lists what is missing.

## 1. Survey the game

Read the whole Python source before writing anything, and note:

- **Screen and speed**: `pyxel.init(w, h, fps=30)`. The GBA shows 240 x 160.
  A screen at most half that in each direction is scaled up by a whole
  factor; a larger one that still fits is centered. A screen that does not
  fit needs a design decision: ask the user before cropping or rescaling.
- **Resources**: `pyxel.load("x.pyxres")`, `.pyxpal` palettes,
  `images[n].load(x, y, "file.png")`. All are baked at build time from the
  manifest; copy the files into `games/<name>/assets/`.
- **Input**: which keys and gamepad buttons it reads. There is no mouse or
  text input on the GBA. A game played with the mouse needs a control
  redesign (ask the user); one that only shows or lightly uses the mouse can
  move a pointer with the D-pad in the game, as `games/draw_api` does.
- **Audio**: `sounds[n].set(...)`, `sounds[n].mml(...)`, `musics[n].set(...)`,
  `play`, `playm`, `stop`.
- **Per-frame work**: loops over many entities, float math in them,
  per-pixel drawing with `pset`, large `blt`/`bltm` areas, text and strings
  built every frame, dither. These decide whether the game fits the frame
  budget (see `AGENTS.md`: about 520,000 cycles at 30 fps, including the copy
  of the screen to the display). Note the screen size: up to about 160 x 120
  the screen lives in fast IWRAM; larger ones make every draw slower.
- **Python features** that need restructuring: classes (inheritance,
  methods mutating `self`), lists of objects, tuples, dicts and sets,
  closures and lambdas stored in data, generators, recursion, exceptions,
  f-strings, `random` or `math` from the standard library.

## 2. Create the game directory

```
games/<name>/
  retro.json     manifest
  game.ts        the port
  assets/        .pyxres, .pyxpal, .png copied from the original
```

`retro.json` (see `tools/lib/manifest.ts`):

```json
{
  "title": "Pyxel Shooter",
  "code": "PSHT",
  "resources": "assets/game.pyxres",
  "palette": "assets/game.pyxpal",
  "images": [{ "bank": 0, "x": 0, "y": 0, "file": "assets/sprites.png" }]
}
```

`title` is the cartridge title (12 characters are stored), `code` four
uppercase characters; the other fields are optional. `images` replaces
`pyxel.images[bank].load(x, y, file)` calls, which the port then drops.

`game.ts` starts with a comment naming the original file, its author and its
license (Pyxel's examples are MIT), and exports three functions:

```ts
// Pyxel Shooter, ported from pyxel/examples/09_shooter.py (Takashi Kitao, MIT).
import { system, screen, color } from "retro";

export function setup(): void {} // App.__init__ up to pyxel.run(), including system.init()
export function update(): void {} // the update callback
export function draw(): void {} // the draw callback
```

## 3. Translate

Translate line by line and keep the original structure, names (in
camelCase), constants and comments, so the port can be checked against the
source. The rules that matter most:

- **Values, not references.** MicroTS copies arrays and structs on
  assignment, argument passing and `for…of`. `const e = enemies[i]; e.x += 1`
  changes a copy. Mutate through the path (`enemies[i].x += 1`) inside an
  index loop, and pass indices to helper functions instead of objects.
  Functions cannot mutate an array argument; return a new value or use a
  module-level `let`.
- **Classes become interfaces plus functions.** Instance state becomes an
  `interface` and a module-level array of it; methods become functions taking
  an index (`updateEnemy(i)`). A constructor that appends itself to a global
  list becomes `push(list, { ...fields })`. Singletons (the player, the App)
  become module-level `let` variables.
- **Removing dead entities**: `list[:] = [e for e in list if e.is_alive]`
  becomes `list = filter(list, (e) => e.isAlive)`. Do not remove elements
  while looping over them by index.
- **Numbers.** Declare integer state as `i32` (the default for integer
  literals). `/` on integers gives a float: use `math.floordiv(a, b)` for
  Python `//` and for `/` on values known to divide evenly, and
  `math.mod(a, b)` for Python `%` when an operand can be negative (TypeScript
  `%` truncates). Convert with `f32(...)` and `math.int(...)`/`math.round(...)`
  explicitly.
- **Floats are slow.** The GBA has no FPU: every float operation is a
  software routine of 50-300 cycles. Keep floats (`f32`) for occasional math,
  but not for state updated every frame for many entities. When a float only
  takes multiples of a power of two (speeds like 1.5, positions like x + 4.0),
  store it scaled as an integer, which is exact (see `games/shooter`: half
  pixels). Otherwise use 16.16 fixed point, which is visually identical.
- **Drawing with floats**: Pyxel rounds float coordinates half away from zero
  (`f32::round`). The SDK draws at integer coordinates; convert with
  `math.round(v)` for `f32` values, and round scaled integers the same way.
- **Tuples** become small interfaces (`interface Star { x: i32; y: i32 }`).
  Functions returning tuples return a struct literal.
- **Strings**: f-strings become template strings; `text.str(n)`,
  `text.rjust(s, width)`, `text.ljust(s, width)`, `text.zfill(n, width)` cover
  padding such as `f"SCORE {score:5}"` →
  `` `SCORE ${text.rjust(text.str(score), 5)}` `` and `f"{score:04}"` →
  `text.zfill(score, 4)`. Every string passed or concatenated is
  copied, so prefer one template string to chains of `+`. Text is drawn with
  Pyxel's 4 x 6 font.
- **Randomness**: `pyxel.rndi`/`rndf` exist as `math.rndi`/`math.rndf`; map
  Python's `random.randint(a, b)` to `math.rndi(a, b)` and `random.random()`
  to `math.rndf(0, 1)`.
- **Keys**: Pyxel's key and button constants live in `input`, without
  their prefix: `KEY_LEFT` → `input.key.LEFT`, `KEY_RETURN` →
  `input.key.RETURN`, `GAMEPAD1_BUTTON_A` → `input.pad.A`,
  `GAMEPAD1_BUTTON_DPAD_LEFT` → `input.pad.DPAD_LEFT`; only `KEY_0` to
  `KEY_9` become `input.key.DIGIT_0` to `DIGIT_9`. They are mapped to GBA
  buttons (arrows/WASD → D-pad, Z/SPACE/KP_ENTER → A, X/BACKSPACE → B,
  RETURN → START and A, TAB → SELECT). Change a mapping with
  `input.map(input.key.X, input.gba.B)` in `setup()` when the default changes
  the game (for example when ENTER restarts a game but A fires). Keys with no
  mapping, such as `input.key.Q`, read as never pressed. Update on-screen
  prompts that name PC keys ("PRESS ENTER" → "PRESS START"), keeping their
  length so centered text stays centered.
- **Things that do nothing on the GBA** (`pyxel.quit()`, window titles,
  mouse cursor) can be dropped or kept as no-ops; say so in a comment.
- **Sound**: keep sound and music definitions as they are.
  `pyxel.sounds[n].set(...)` → `sound.set(n, ...)`,
  `pyxel.sounds[n].mml(code)` → `sound.mml(n, code)` (the same MML text,
  string concatenation included), `pyxel.musics[n].set([a], [b])` →
  `music.set(n, [a], [b])`, `pyxel.playm(n, loop=True)` →
  `music.play(n, true)`, `play(ch, snd, loop=True, resume=True)` →
  `sound.play(ch, snd, true, true)`. The SDK plays both kinds of sound as
  pyxel-core 2.9 does, including envelopes, vibrato, glide and `resume`.
  `play(..., sec=…)` is not supported.

MicroTS rejects what it cannot compile with a source location and a message;
fix the port rather than working around the compiler. Its supported subset
is documented in `pocketjs/site/content/docs/typescript-support.md`.
Messages a port commonly meets:

| Message or symptom                                        | Fix                                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `numeric type cannot change from i32 to f64`              | `/` on integers is float division: use `math.floordiv`, `idiv` or `>>`                                                           |
| `unsupported unary operator`                              | `++x`/`--x` inside an expression: increment in its own statement                                                                 |
| `a namespace names its members; it is not a value`        | namespaces such as `screen` cannot be stored or passed: call `screen.cls(...)` where needed                                      |
| `private field seeds require constants or literal values` | a module-level `let` starts from literals, constants and `fill(...)` of them; compute anything else in `setup()`                 |
| `Argument of type 'i32' is not assignable to … 1000000`   | a literal first argument fixes a generic's type: name it as a typed `const`                                                      |
| a helper's change to an array argument is lost            | arguments are copies: mutate module state, or return the new value                                                               |
| a game that ran fine becomes slow                         | a copy in a hot path: `const e = list[i]`, `for (const e of list)` over structs with arrays, a function returning a stored array |
| `list[math.rndi(0, n)]` copies `list`                     | an index that calls a function reads the array first, as JavaScript does: draw the index into a local, then index                |

## 4. Build, play and check

```sh
bun tools/build.ts games/<name>
bun tools/run.ts dist/<name>.gba --script="60:- 5:START 60:- 30:A 60:LEFT" --shots=/tmp/<name>
bun tools/run.ts dist/<name>.gba --frames=600 --shot=/tmp/<name>.png --wav=/tmp/<name>.wav
```

A script is a list of `frames:KEYS` steps (`-` releases all keys);
`--shots` saves a screenshot after each step. Step lengths count VBlanks (60
a second), not game frames: at 30 fps, a scene that starts at game frame 150
starts after 300 VBlanks. Look at the screenshots and
check each scene of the game: title, play, game over, scrolling, sound
effects in the WAV. When Pyxel itself is available (`pip install pyxel`),
run the original next to the port and compare the screens; for music,
`pyxel.musics[n].save("ref.wav", seconds)` renders Pyxel's version of a
tune to compare with the ROM's WAV.

Add the game to `SCRIPTS` in `tests/games.test.ts` with input that reaches
its main scenes, and run `bun test tests/games.test.ts`: every game must
build, draw, and keep up with its frame rate.

## 5. Fit the frame budget

Every second the ROM prints
`stats frames=… game=avg/max present=… late=… …` (see `AGENTS.md` for the
fields). `late` must stay 0 after the first second. If it does not:

1. Profile a `--no-inline` build: `bun tools/build.ts games/<name> --no-inline`,
   `bun tools/profile.ts games/<name> --script=...`, then
   `--within=<function>` for the hottest addresses of a function.
2. Fix the game first: floats in per-entity loops, copies of arrays in hot
   code (`for…of` over big arrays of structs, passing arrays), per-pixel
   `pset` loops that a `rect`, `blt` or `bltm` could do. Lists filtered every
   frame are cheaper compacted in place (copy the survivors down, then
   `truncate`) than rebuilt by `filter` (Mega Wing: 15,000 cycles a frame for
   four lists). Watch `game`'s max as well as its mean: work that lines up
   on the same frames, such as enemies that all fire on multiples of 10
   frames, makes them late; compute `math.sin`, `cos` and `atan2` (thousands
   of cycles each) once for angles that never change.
3. If the SDK is the bottleneck, improve `sdk/` for every game and follow
   the performance rules in `AGENTS.md` (`@iwram`, IWRAM budget, array
   builtins). Compare changes by the mean `game` value over the same script,
   and run `bun test tests/games.test.ts` afterwards: SDK code and fields
   take IWRAM that other games' screens need.

## 6. Finish

- Commit the port on its own: `feat(games): port <Title>` (Conventional
  Commits; lefthook formats the files). SDK additions go in separate
  `feat(sdk): …` commits before it.
- Add what you learned that other ports need to `AGENTS.md` or to this skill.
