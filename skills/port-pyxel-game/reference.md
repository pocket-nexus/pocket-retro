# Pyxel API → Pocket Pyxel SDK

Naming: module functions keep Pyxel's names in camelCase; methods of
`pyxel.images[n]` become `img*(n, …)` and those of `pyxel.tilemaps[n]`
`tilemap*(n, …)`, except the short `tget`/`tset`. New SDK functions follow
the same pattern.

Everything below is imported from `"pyxel"` (`sdk/pyxel.ts`) unless marked
_std_, which is `@pocketjs/framework/solid/std`. Integer parameters are
`i32`; Pyxel's float coordinates become integers (round with `round(v)`).

## System

| Pyxel                                      | SDK                                                        |
| ------------------------------------------ | ---------------------------------------------------------- |
| `pyxel.init(w, h, title=…, fps=30)`        | `init(w, h, fps)` in `setup()`; title goes in `pyxel.json` |
| `pyxel.run(update, draw)`                  | export `update()` and `draw()`                             |
| `pyxel.width`, `pyxel.height`              | `width()`, `height()`                                      |
| `pyxel.frame_count`                        | `frameCount()`                                             |
| `pyxel.load("x.pyxres")`                   | `"resources"` in `pyxel.json`                              |
| `pyxel.quit()`                             | `quit()` (does nothing)                                    |
| `pyxel.colors[i] = rgb`, `pyxel.colors[i]` | `setColor(i, rgb)`, `getColor(i)`; `setColors(list)`       |
| `.pyxpal` palette                          | `"palette"` in `pyxel.json`                                |

## Drawing (screen)

| Pyxel                                               | SDK                                                |
| --------------------------------------------------- | -------------------------------------------------- |
| `cls`, `pget`, `pset`, `line`, `rect`, `rectb`      | same names                                         |
| `circ`, `circb`, `elli`, `ellib`, `tri`, `trib`     | same names                                         |
| `fill(x, y, col)`                                   | `fill(x, y, col)` (flood fill; not _std_ `fill`)   |
| `blt(x, y, img, u, v, w, h, colkey, rotate, scale)` | `blt(...)`, same order; `rotate`/`scale` are `f32` |
| `bltm(x, y, tm, u, v, w, h, colkey)`                | `bltm(...)`                                        |
| `text(x, y, s, col)`                                | `text(...)`; `textWidth(s)`                        |
| `pal(c1, c2)`, `pal()`                              | `pal(c1, c2)`, `pal()`                             |
| `dither(alpha)`                                     | `dither(f32(alpha))`                               |
| `camera(x, y)`, `clip(x, y, w, h)`                  | `camera(x, y)`, `clip(x, y, w, h)`                 |

Name clashes with _std_: import _std_'s `fill` under another name
(`import { fill as filled } from …`) if the game also uses flood fill.

## Images and tilemaps

| Pyxel                                                  | SDK                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pyxel.images[n].pset(...)`, `.cls`, …                 | `imgPset(n, ...)`, `imgCls`, `imgLine`, `imgRect`, `imgRectb`, `imgCirc`, `imgCircb`, `imgTri`, `imgFill`, `imgBlt`, `imgBltm`, `imgText`, `imgPget` |
| `pyxel.images[n].set(x, y, rows)`                      | `imgSet(n, x, y, rows)`                                                                                                                              |
| `pyxel.images[n].load(x, y, "a.png")`                  | `"images"` in `pyxel.json` (baked, drop the call)                                                                                                    |
| `pyxel.tilemaps[n].pget(x, y)` / `tile`                | `tget(n, x, y)` returns a tile value; `tile(tx, ty)`, `tileX(t)`, `tileY(t)`                                                                         |
| `pyxel.tilemaps[n].pset(x, y, (tx, ty))`               | `tset(n, x, y, tile(tx, ty))`                                                                                                                        |
| `pyxel.tilemaps[n].set(x, y, rows)`                    | `tilemapSet(n, x, y, rows)` (four hex digits per tile)                                                                                               |
| `pyxel.tilemaps[n].imgsrc`                             | `tilemapImgsrc(n)`, `setTilemapImgsrc(n, img)`                                                                                                       |
| `pyxel.tilemaps[n].collide(x, y, w, h, dx, dy, walls)` | `collide(n, x, y, w, h, dx, dy, walls(tiles))` → `{ dx, dy }`; register the wall list once with `walls()` in `setup()`                               |

Tile tuples `(tx, ty)` are single `i32` values; compare them with `===`.
The first write to an image bank copies it into RAM: 64 KiB of the 256 KiB
work RAM per written bank, and slower tilemap drawing from it afterwards.
Prefer baking images (`"images"` in `pyxel.json`) to drawing them at start.

## Input

| Pyxel                                         | SDK                                           |
| --------------------------------------------- | --------------------------------------------- |
| `btn(key)`, `btnp(key, hold, repeat)`, `btnr` | same names, same `KEY_*` / `GAMEPAD1_*` names |
| mouse, `mouse_x`, text input                  | not available: redesign the controls          |
| key layout                                    | `mapKey(KEY_*, GBA_A \| GBA_B …)`             |

## Audio

| Pyxel                                                              | SDK                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `pyxel.sounds[n].set(notes, tones, volumes, effects, speed)`       | `soundSet(n, notes, tones, volumes, effects, speed)`                      |
| `pyxel.sounds[n].mml(code)`                                        | `soundMml(n, code)`                                                       |
| `pyxel.musics[n].set(s0, s1, s2, s3)`                              | `musicSet(n, s0, s1, s2, s3)` (later lists optional)                      |
| `play(ch, snd, loop=, resume=)`                                    | `play(ch, snd, loop, resume)`; a list: `playList(ch, snds, loop, resume)` |
| `playm(msc, loop=)`, `stop(ch)`, `stop()`                          | same names                                                                |
| `play_pos(ch)`                                                     | `playPosSound(ch)`, `playPosNote(ch)`                                     |
| `play(..., sec=…)`, PCM sounds, `channels[n].gain`, custom `tones` | not available                                                             |

Both kinds of sound run as pyxel-core 2.9 command lists (`sdk/sound.ts`,
`sdk/audio.ts`). Differences a port can hear: notes start and end on the
mixer's 1/239 s ticks (their timing does not drift), envelope, vibrato and
glide slots are numbered 1-15 per channel, and an envelope keeps its first
8 segments. `soundMml` leaves a sound unchanged when its text has an error;
the message is in `mmlError` of `sdk/sound.ts`.

## Math and text

| Pyxel / Python                                          | SDK                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `pyxel.rndi(a, b)`, `pyxel.rndf(a, b)`                  | `rndi(a, b)`, `rndf(a, b)`; `rseed(n)`                      |
| `pyxel.noise`, `nseed`                                  | `noise(x, y, z)`, `nseed(n)`                                |
| `pyxel.clamp`, `pyxel.sgn` (ints)                       | `clamp(x, lo, hi)`, `sgn(x)`; floats: _std_ `clamp`         |
| `pyxel.sqrt`, `sin`, `cos`, `atan2` (degrees)           | `sqrt`, `sin`, `cos`, `atan2` (`f32`, degrees)              |
| `a // b`, `a % b` (Python)                              | `floordiv(a, b)`, `mod(a, b)`                               |
| `int(x)`, `round(x)`, `math.floor`, `math.ceil`         | `int(x)`, `round(x)`, `floor(x)`, `ceil(x)` (`f32` → `i32`) |
| `abs`, `min`, `max`                                     | _std_ `abs`, `min`, `max`                                   |
| `str(n)`, `s.rjust(w)`, `s.ljust(w)`, `str(n).zfill(w)` | `str(n)`, `rjust(s, w)`, `ljust(s, w)`, `zfill(n, w)`       |
| `len(x)`, `list.append`, `list.pop`, `list.insert`      | _std_ `len`, `push`, `pop`, `insert`, `removeAt`            |
| `[e for e in xs if cond]`                               | _std_ `filter(xs, (e) => cond)`                             |
| `[f(e) for e in xs]`                                    | _std_ `map(xs, (e) => f(e))`                                |
| `list.clear()`, `xs = []`                               | `xs = []` or _std_ `clear(xs)`                              |
