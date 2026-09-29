# Pyxel API → Pocket Retro SDK

The SDK groups Pyxel's API in namespaces, all imported from `"retro"`:

```ts
import {
  system,
  screen,
  image,
  tilemap,
  input,
  sound,
  music,
  math,
  text,
  color,
} from "retro";
```

Import only the namespaces a game uses. Each is one file in `sdk/api/`, the
authoritative list of its members. Inside a namespace, names follow Pyxel in
camelCase; methods of `pyxel.images[n]` and `pyxel.tilemaps[n]` take the bank
or tilemap first (`image.pset(1, x, y, c)`). Pyxel's constants become
lowercase members (`COLOR_NAVY` → `color.navy`, `KEY_LEFT` →
`input.key.left`). New SDK functions go in the namespace they belong to.
Namespaces only name their members: they cannot be stored in variables or
passed to functions.

_std_ marks `@pocketjs/framework/solid/std`. Integer parameters are `i32`;
Pyxel's float coordinates become integers (round with `math.round(v)`).

## system

| Pyxel                               | SDK                                                                   |
| ----------------------------------- | --------------------------------------------------------------------- |
| `pyxel.init(w, h, title=…, fps=30)` | `system.init(w, h, fps)` in `setup()`; the title goes in `retro.json` |
| `pyxel.run(update, draw)`           | export `update()` and `draw()`                                        |
| `pyxel.width`, `pyxel.height`       | `system.width()`, `system.height()`                                   |
| `pyxel.frame_count`                 | `system.frameCount()`                                                 |
| `pyxel.quit()`                      | `system.quit()` (does nothing)                                        |
| `pyxel.load("x.pyxres")`            | `"resources"` in `retro.json`                                         |
| `.pyxpal` palette                   | `"palette"` in `retro.json`                                           |

## screen

| Pyxel                                               | SDK                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `cls`, `pget`, `pset`, `line`, `rect`, `rectb`      | `screen.cls`, `screen.pget`, … with the same arguments                                           |
| `circ`, `circb`, `elli`, `ellib`, `tri`, `trib`     | `screen.circ`, …                                                                                 |
| `fill(x, y, col)` (flood fill)                      | `screen.fill(x, y, col)`                                                                         |
| `blt(x, y, img, u, v, w, h, colkey, rotate, scale)` | `screen.blt(...)`, same order; `rotate`/`scale` are `f32`                                        |
| `bltm(x, y, tm, u, v, w, h, colkey)`                | `screen.bltm(...)`                                                                               |
| `text(x, y, s, col)`                                | `screen.text(...)`                                                                               |
| `pal(c1, c2)`, `pal()`                              | `screen.pal(c1, c2)`, `screen.pal()`                                                             |
| `dither(alpha)`                                     | `screen.dither(f32(alpha))`                                                                      |
| `camera(x, y)`, `clip(x, y, w, h)`                  | `screen.camera(x, y)`, `screen.clip(x, y, w, h)`                                                 |
| `pyxel.colors[i] = rgb`, `pyxel.colors[i]`          | `screen.setColor(i, rgb)`, `screen.getColor(i)`; `screen.setColors(list)`, `screen.colorCount()` |
| `pyxel.screen` as a blt source                      | `image.screen`                                                                                   |

## color

`COLOR_BLACK` … `COLOR_PEACH` → `color.black`, `color.navy`, `color.purple`,
`color.green`, `color.brown`, `color.darkBlue`, `color.lightBlue`,
`color.white`, `color.red`, `color.orange`, `color.yellow`, `color.lime`,
`color.cyan`, `color.gray`, `color.pink`, `color.peach`; `NUM_COLORS` →
`color.count`.

## image and tilemap

| Pyxel                                                  | SDK                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pyxel.images[n].pset(...)`, `.cls`, `.blt`, …         | `image.pset(n, ...)`, `image.pget`, `image.cls`, `image.line`, `image.rect`, `image.rectb`, `image.circ`, `image.circb`, `image.tri`, `image.fill`, `image.blt`, `image.bltm`, `image.text` |
| `pyxel.images[n].set(x, y, rows)`                      | `image.set(n, x, y, rows)`                                                                                                                                                                  |
| `pyxel.images[n].load(x, y, "a.png")`                  | `"images"` in `retro.json` (baked, drop the call)                                                                                                                                           |
| `NUM_IMAGES`, `IMAGE_SIZE`                             | `image.count`, `image.size`                                                                                                                                                                 |
| `pyxel.tilemaps[n].pget(x, y)`                         | `tilemap.pget(n, x, y)` returns a tile value; `tilemap.tile(tx, ty)`, `tilemap.tileX(t)`, `tilemap.tileY(t)`                                                                                |
| `pyxel.tilemaps[n].pset(x, y, (tx, ty))`               | `tilemap.pset(n, x, y, tilemap.tile(tx, ty))`                                                                                                                                               |
| `pyxel.tilemaps[n].set(x, y, rows)`                    | `tilemap.set(n, x, y, rows)` (four hex digits per tile)                                                                                                                                     |
| `pyxel.tilemaps[n].imgsrc`                             | `tilemap.imgsrc(n)`, `tilemap.setImgsrc(n, img)`                                                                                                                                            |
| `pyxel.tilemaps[n].collide(x, y, w, h, dx, dy, walls)` | `tilemap.collide(n, x, y, w, h, dx, dy, set)` → `{ dx, dy }`, with `set = tilemap.walls(tiles)` registered once in `setup()`                                                                |
| `NUM_TILEMAPS`, `TILEMAP_SIZE`, `TILE_SIZE`            | `tilemap.count`, `tilemap.size`, `tilemap.tileSize`                                                                                                                                         |

Tile tuples `(tx, ty)` are single `i32` values; compare them with `===`.
The first write to an image bank copies it into RAM: 64 KiB of the 256 KiB
work RAM per written bank, and slower tilemap drawing from it afterwards.
Prefer baking images (`"images"` in `retro.json`) to drawing them at start.

## input

| Pyxel                                                            | SDK                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `btn(key)`, `btnp(key, hold, repeat)`, `btnr`                    | `input.btn(key)`, `input.btnp(key, hold, repeat)`, `input.btnr(key)`                         |
| `KEY_A` … `KEY_Z`, `KEY_0` … `KEY_9`                             | `input.key.a` … `input.key.z`, `input.key.digit0` … `input.key.digit9`                       |
| `KEY_UP`, `KEY_SPACE`, `KEY_RETURN`, `KEY_KP_ENTER`, `KEY_F1`, … | `input.key.up`, `input.key.space`, `input.key.enter`, `input.key.kpEnter`, `input.key.f1`, … |
| `GAMEPAD1_BUTTON_A`, `…_START`, `…_DPAD_LEFT`, `…_LEFTSHOULDER`  | `input.pad.a`, `input.pad.start`, `input.pad.left`, `input.pad.leftShoulder`                 |
| `MOUSE_BUTTON_LEFT`, mouse position, text input                  | `input.mouse.left` reads as never pressed; redesign the controls                             |
| key layout                                                       | `input.map(input.key.x, input.gba.b)`; combine GBA buttons with `\|`                         |

## sound and music

| Pyxel                                                              | SDK                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `pyxel.sounds[n].set(notes, tones, volumes, effects, speed)`       | `sound.set(n, notes, tones, volumes, effects, speed)`                                 |
| `pyxel.sounds[n].mml(code)`                                        | `sound.mml(n, code)`                                                                  |
| `play(ch, snd, loop=, resume=)`                                    | `sound.play(ch, snd, loop, resume)`; a list: `sound.playList(ch, snds, loop, resume)` |
| `stop(ch)`, `stop()`                                               | `sound.stop(ch)`, `sound.stop()`                                                      |
| `play_pos(ch)`                                                     | `sound.playingSound(ch)`, `sound.playingNote(ch)`, `sound.isPlaying(ch)`              |
| `TONE_*`, `EFFECT_*`, `NUM_CHANNELS`, `NUM_SOUNDS`                 | `sound.tone.noise`, `sound.effect.vibrato`, `sound.channels`, `sound.count`           |
| `pyxel.musics[n].set(s0, s1, s2, s3)`                              | `music.set(n, s0, s1, s2, s3)` (later lists optional)                                 |
| `playm(msc, loop=)`, `NUM_MUSICS`                                  | `music.play(msc, loop)`, `music.count`                                                |
| `play(..., sec=…)`, PCM sounds, `channels[n].gain`, custom `tones` | not available                                                                         |

Both kinds of sound run as pyxel-core 2.9 command lists (`sdk/sound.ts`,
`sdk/audio.ts`). Differences a port can hear: notes start and end on the
mixer's 1/239 s ticks (their timing does not drift), envelope, vibrato and
glide slots are numbered 1-15 per channel, and an envelope keeps its first
8 segments. `sound.mml` leaves a sound unchanged when its text has an error;
the message is in `mmlError` of `sdk/sound.ts`.

## math and text

| Pyxel / Python                                          | SDK                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pyxel.rndi(a, b)`, `pyxel.rndf(a, b)`, `rseed`         | `math.rndi(a, b)`, `math.rndf(a, b)`, `math.rseed(n)`                           |
| `pyxel.noise`, `nseed`                                  | `math.noise(x, y, z)`, `math.nseed(n)`                                          |
| `pyxel.clamp`, `pyxel.sgn` (ints)                       | `math.clamp(x, lo, hi)`, `math.sgn(x)`; floats: _std_ `clamp`                   |
| `pyxel.sqrt`, `sin`, `cos`, `atan2` (degrees)           | `math.sqrt`, `math.sin`, `math.cos`, `math.atan2` (`f32`, degrees)              |
| `a // b`, `a % b` (Python)                              | `math.floordiv(a, b)`, `math.mod(a, b)`                                         |
| `int(x)`, `round(x)`, `math.floor`, `math.ceil`         | `math.int(x)`, `math.round(x)`, `math.floor(x)`, `math.ceil(x)` (`f32` → `i32`) |
| `abs`, `min`, `max`                                     | _std_ `abs`, `min`, `max`                                                       |
| `str(n)`, `s.rjust(w)`, `s.ljust(w)`, `str(n).zfill(w)` | `text.str(n)`, `text.rjust(s, w)`, `text.ljust(s, w)`, `text.zfill(n, w)`       |
| `FONT_WIDTH`, `FONT_HEIGHT`, text width                 | `text.fontWidth`, `text.fontHeight`, `text.width(s)`                            |
| `len(x)`, `list.append`, `list.pop`, `list.insert`      | _std_ `len`, `push`, `pop`, `insert`, `removeAt`                                |
| `[e for e in xs if cond]`                               | _std_ `filter(xs, (e) => cond)`                                                 |
| `[f(e) for e in xs]`                                    | _std_ `map(xs, (e) => f(e))`                                                    |
| `list.clear()`, `xs = []`                               | `xs = []` or _std_ `clear(xs)`                                                  |
