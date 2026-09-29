/** Musics (pyxel.musics[n], playm): one list of sounds per channel. `music.play(0, true)`. */
import type { i32 as I32 } from "@pocketjs/framework/solid/std";
import { NUM_MUSICS, playMusic, setMusic } from "../audio";

/** Musics (NUM_MUSICS). */
export const COUNT: I32 = NUM_MUSICS;

/** pyxel.musics[msc].set(seq0, seq1, seq2, seq3); channels left out play nothing. */
export function set(msc: I32, seq0: I32[], seq1: I32[] = [], seq2: I32[] = [], seq3: I32[] = []): void {
  setMusic(msc, seq0, seq1, seq2, seq3);
}

/** pyxel.playm(msc, loop). */
export function play(msc: I32, loop: boolean = false): void {
  playMusic(msc, loop);
}
