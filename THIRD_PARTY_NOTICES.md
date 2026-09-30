# Third-party notices

Pocket Retro's own code is under the [MIT License](LICENSE). It reproduces
parts of other works, whose notices follow.

## Pyxel

<https://github.com/kitao/pyxel>, MIT License, Copyright (c) 2018-2026
Takashi Kitao.

- `sdk/` reproduces Pyxel's API and follows pyxel-core in its drawing,
  tilemap, sound and MML behavior; it contains pyxel-core's 4 × 6 font data
  and default palette.
- These games are ports of Pyxel's examples and bundled apps, and contain
  their resources:

| Game                   | Original                                    | Author          |
| ---------------------- | ------------------------------------------- | --------------- |
| `games/jump`           | `pyxel/examples/02_jump_game.py`            | Takashi Kitao   |
| `games/draw_api`       | `pyxel/examples/03_draw_api.py`             | Takashi Kitao   |
| `games/snake`          | `pyxel/examples/07_snake.py`                | Marcus Croucher |
| `games/shooter`        | `pyxel/examples/09_shooter.py`              | Takashi Kitao   |
| `games/platformer`     | `pyxel/examples/10_platformer.py`           | Takashi Kitao   |
| `games/space_rescue`   | `pyxel/examples/apps/space_rescue.pyxapp`   | Takashi Kitao   |
| `games/mega_wing`      | `pyxel/examples/apps/mega_wing.pyxapp`      | Takashi Kitao   |
| `games/cursed_caverns` | `pyxel/examples/apps/cursed_caverns.pyxapp` | Takashi Kitao   |

```
MIT License

Copyright (c) 2018-2026 Takashi Kitao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Games by Adam (helpcomputer)

These games ship with Pyxel as bundled apps; the ports contain their
resources. Laser Jetman's license names its copyright holder as below;
Megaball's README and the Pyxel app of 30 Seconds of Daylight state the MIT
License for the same author.

| Game                 | Original                                                                                           | Credits                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `games/daylight`     | [30 Seconds of Daylight](https://github.com/kitao/30SecondsOfDaylight), the first Pyxel Jam winner | Adam                                                                                |
| `games/megaball`     | [Megaball](https://github.com/helpcomputer/megaball), made for Game Boy Jam 8                      | Game design and art by Adam, sound and music by Mike Richmond, font by Damien Guard |
| `games/laser_jetman` | [Laser Jetman](https://github.com/helpcomputer/laser-jetman)                                       | Adam                                                                                |

```
MIT License

Copyright (c) 2022 helpcomputer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Build and development tools

These are not part of the repository but are used to build and test it:

- [PocketJS](https://github.com/pocket-nexus/pocketjs) (MIT License), a git
  submodule in `pocketjs/`. Its `microts` crate is linked into every ROM.
- Rust crates from crates.io, pinned in `runtime/gba/Cargo.lock`, such as
  `linked_list_allocator`, `critical-section`, `heapless` and `libm`. They
  are under permissive licenses (MIT, Apache-2.0, Zlib, BSL-1.0 or
  Unlicense), which come with their sources, and parts of them are compiled
  into ROMs.
- [mGBA](https://mgba.io) (Mozilla Public License 2.0), downloaded and built
  by `tools/emu/setup.ts` to play ROMs headless. It is not part of the ROMs.
