/**
 * Sounds and their playback (pyxel.sounds[n], play, stop): sounds are defined
 * with set() or mml() and played on four channels. `sound.play(3, 0)`.
 */
import type { i32 as I32 } from "@pocketjs/framework/solid/std";
import {
  isPlaying as audioIsPlaying,
  NUM_CHANNELS,
  NUM_SOUNDS,
  play as audioPlay,
  playingNote as audioPlayingNote,
  playingSound as audioPlayingSound,
  setMml,
  setSound,
  stop as audioStop,
} from "../audio";

export * as tone from "./tone";
export * as effect from "./effect";

/** Channels (NUM_CHANNELS). */
export const channels: I32 = NUM_CHANNELS;
/** Sounds (NUM_SOUNDS). */
export const count: I32 = NUM_SOUNDS;

/** pyxel.sounds[snd].set(notes, tones, volumes, effects, speed). */
export function set(snd: I32, notes: string, tones: string, volumes: string, effects: string, speed: I32): void {
  setSound(snd, notes, tones, volumes, effects, speed);
}

/**
 * pyxel.sounds[snd].mml(code): Pyxel 2's MML (T, Q, V, K, Y, @tone, @ENV,
 * @VIB, @GLI, O, <, >, L, notes, R, &, [ ]n). The sound plays it instead of
 * its notes until given empty MML; text with an error leaves it unchanged.
 */
export function mml(snd: I32, code: string): void {
  setMml(snd, code);
}

/** Plays sound `snd` on channel `ch`; resume returns to what the channel played after it. */
export function play(ch: I32, snd: I32, loop: boolean = false, resume: boolean = false): void {
  audioPlay(ch, [snd], loop, resume);
}

/** Plays a list of sounds in order on channel `ch`. */
export function playList(ch: I32, snds: I32[], loop: boolean = false, resume: boolean = false): void {
  audioPlay(ch, snds, loop, resume);
}

/** stop(ch) stops one channel; stop() stops all. */
export function stop(ch: I32 = -1): void {
  if (ch >= 0) {
    audioStop(ch);
    return;
  }
  for (let c = 0; c < NUM_CHANNELS; c++) audioStop(c);
}

export function isPlaying(ch: I32): boolean {
  return audioIsPlaying(ch);
}

/** The sound playing on a channel, or -1 (the first half of pyxel.play_pos). */
export function playingSound(ch: I32): I32 {
  return audioPlayingSound(ch);
}

/** The index of the note playing on a channel, or -1. */
export function playingNote(ch: I32): I32 {
  return audioPlayingNote(ch);
}
