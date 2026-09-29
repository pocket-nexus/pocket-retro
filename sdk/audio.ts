/**
 * Pyxel's sound playback. Four channels execute sounds' command lists
 * (sdk/sound.ts) as pyxel-core's channel.rs and voice.rs do: tempo, gate,
 * tone, volume, transpose and detune settings, envelope, vibrato and glide
 * slots, notes, rests and repeats, timed in Pyxel's 1,789,773 Hz clock.
 *
 * The host's mixer synthesizes one voice record per channel per audio tick
 * (76 output samples, about 1/239 s), so each tick emits every channel's
 * tone, pitch and amplitude at the middle of the tick. Notes start and stop
 * on tick boundaries, but event times are kept exactly, so channels never
 * drift apart. The mixer ramps amplitude changes over 0.8 ms, as Pyxel fades
 * notes in and out.
 */
import {
  codePoints,
  f64,
  fill,
  i32,
  idiv,
  len,
  pow,
  push,
  round,
  type f64 as F64,
  type i32 as I32,
} from "@pocketjs/framework/solid/std";
import { MUSIC_STARTS, MUSICS, SOUND_STARTS, SOUNDS } from "./assets";
import { AUDIO_RATE, pushVoice } from "./hw";
import {
  classicCommands,
  CMD_DETUNE,
  CMD_ENVELOPE,
  CMD_ENVELOPE_SET,
  CMD_GLIDE,
  CMD_GLIDE_SET,
  CMD_NOTE,
  CMD_QUANTIZE,
  CMD_REPEAT_END,
  CMD_REPEAT_START,
  CMD_REST,
  CMD_TEMPO,
  CMD_TONE,
  CMD_TRANSPOSE,
  CMD_VIBRATO,
  CMD_VIBRATO_SET,
  CMD_VOLUME,
  commandSize,
  mmlError,
  parseMml,
  UNSET,
} from "./sound";

export const NUM_CHANNELS: I32 = 4;
export const NUM_SOUNDS: I32 = 64;
export const NUM_MUSICS: I32 = 8;
export const TONE_NOISE: I32 = 3;
/**
 * Amplitude of each tone at full volume: Pyxel's tone gains (1.0, 0.3, 0.3,
 * 0.6) times the channel gain 0.125, scaled for the mixer's 8-bit output
 * (amplitude * sample >> 6 for waveform samples in -15..15).
 */
const TONE_AMP: I32[] = [203, 61, 61, 122];
/**
 * Clocks per audio tick: 76 samples at the mixer's rate, 7491.43 clocks,
 * as 7491 plus a remainder accumulated in 1/1048576 clocks.
 */
const TICK_CLOCKS: I32 = 7491;
const TICK_REMAINDER: I32 = 430881;
const TICK_UNIT: I32 = 1048576;
/** Slots per channel for envelopes, vibratos and glides; higher slots are ignored. */
const SLOTS: I32 = 16;
/** Envelope segments kept per slot. */
const SEGMENTS: I32 = 8;
const REPEAT_DEPTH: I32 = 8;
/** Longest note or rest in clocks, about 9 minutes. */
const MAX_EVENT_CLOCKS: I32 = 1000000000;
/** Envelope level 1.0: 127 in 1/256 steps. */
const FULL_LEVEL: I32 = 127 * 256;

// Sounds and musics.
let classic: I32[][] = [];
let mml: I32[][] = [];
let musicSeqs: I32[][] = [];
/** Phase step per output sample of a 32-sample waveform at each MIDI note, 16.16 fixed point. */
let noteSteps: I32[] = fill(161, 0);
let tickRemainder: I32 = 0;

// Repeat stacks, per channel and depth (index channel * REPEAT_DEPTH + depth).
let chRepeatAt: I32[] = fill(4 * REPEAT_DEPTH, 0);
let chRepeatCount: I32[] = fill(4 * REPEAT_DEPTH, 0);
let chRepeatClock: I32[] = fill(4 * REPEAT_DEPTH, 0);
/** A channel's playlist and position, the settings commands change, and its note. */
interface Channel {
  playing: boolean;
  loop: boolean;
  sounds: I32[];
  sound: I32;
  command: I32;
  /** Clocks from the start of the current tick to the end of the current note or rest. */
  remaining: I32;
  /** Clocks into the current sound. */
  soundClock: I32;
  /** Clocks from the playlist's start to the current tick. */
  playClock: I32;
  notes: I32;
  repeatDepth: I32;
  /** A sound effect played with resume: the playlist it interrupted. */
  saved: boolean;
  savedSounds: I32[];
  savedLoop: boolean;
  clocksPerTick: I32;
  gate: I32;
  tone: I32;
  volume: I32;
  transpose: I32;
  detune: I32;
  envelope: I32;
  vibrato: I32;
  glideOn: boolean;
  glidePending: boolean;
  pendingOffset: I32;
  pendingTicks: I32;
  /** Glide of each note: offset in 1/64 semitones and ticks. */
  glideOffset: I32;
  glideTicks: I32;
  /** Pitch of the last note in 1/64 semitones, or UNSET since play(). */
  lastPitch: I32;
  noteOn: boolean;
  notePitch: I32;
  noteVolume: I32;
  noteGate: I32;
  /** Clocks from the note's start to the start of the current tick. */
  noteElapsed: I32;
  /** The same time in 1/256 of the note's ticks, and its step per audio tick. */
  noteFine: I32;
  fineStep: I32;
  /** Ticks the voice has sounded since play(), in 1/256 ticks; drives undelayed vibrato. */
  playback: I32;
}

function newChannel(): Channel {
  return {
    playing: false,
    loop: false,
    sounds: [],
    sound: 0,
    command: 0,
    remaining: 0,
    soundClock: 0,
    playClock: 0,
    notes: 0,
    repeatDepth: 0,
    saved: false,
    savedSounds: [],
    savedLoop: false,
    clocksPerTick: 18643,
    gate: 80,
    tone: 0,
    volume: 3225,
    transpose: 0,
    detune: 0,
    envelope: -1,
    vibrato: -1,
    glideOn: false,
    glidePending: false,
    pendingOffset: 0,
    pendingTicks: 0,
    glideOffset: 0,
    glideTicks: 0,
    lastPitch: UNSET,
    noteOn: false,
    notePitch: 0,
    noteVolume: 0,
    noteGate: 0,
    noteElapsed: 0,
    noteFine: 0,
    fineStep: 0,
    playback: 0,
  };
}

let channels: Channel[] = [];

// Slot definitions, per channel and slot (index channel * SLOTS + slot).
let envInitial: I32[] = fill(4 * SLOTS, -1);
let envCount: I32[] = fill(4 * SLOTS, 0);
let envTicks: I32[] = fill(4 * SLOTS * SEGMENTS, 0);
let envLevels: I32[] = fill(4 * SLOTS * SEGMENTS, 0);
let vibDefined: boolean[] = fill(4 * SLOTS, false);
let vibDelay: I32[] = fill(4 * SLOTS, 0);
let vibPeriod: I32[] = fill(4 * SLOTS, 0);
let vibDepth: I32[] = fill(4 * SLOTS, 0);
let gliDefined: boolean[] = fill(4 * SLOTS, false);
let gliOffset: I32[] = fill(4 * SLOTS, 0);
let gliTicks: I32[] = fill(4 * SLOTS, 0);

export function reset(): void {
  const scale: F64 = f64(32 * 65536) / f64(AUDIO_RATE);
  for (let m = 0; m < len(noteSteps); m++)
    noteSteps[m] = i32(round(f64(440) * pow(f64(2), f64(m - 69) / f64(12)) * scale));
  classic = [];
  mml = [];
  for (let n = 0; n < NUM_SOUNDS; n++) {
    push(classic, []);
    push(mml, []);
    const start = n < len(SOUND_STARTS) ? SOUND_STARTS[n] : -1;
    if (start >= 0) loadSound(n, start);
  }
  musicSeqs = [];
  for (let n = 0; n < NUM_MUSICS * NUM_CHANNELS; n++) push(musicSeqs, []);
  for (let n = 0; n < NUM_MUSICS; n++) {
    const start = n < len(MUSIC_STARTS) ? MUSIC_STARTS[n] : -1;
    if (start < 0) continue;
    let at = start + NUM_CHANNELS;
    for (let c = 0; c < NUM_CHANNELS; c++) {
      for (let i = 0; i < MUSICS[start + c]; i++) push(musicSeqs[n * NUM_CHANNELS + c], MUSICS[at + i]);
      at += MUSICS[start + c];
    }
  }
  channels = [];
  for (let c = 0; c < NUM_CHANNELS; c++) push(channels, newChannel());
}

/** Reads a baked sound record: speed, four lengths, then notes, tones, volumes and effects. */
function loadSound(n: I32, start: I32): void {
  const lists: I32[][] = [[], [], [], []];
  let at = start + 5;
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < SOUNDS[start + 1 + k]; i++) push(lists[k], SOUNDS[at + i]);
    at += SOUNDS[start + 1 + k];
  }
  classic[n] = classicCommands(lists[0], lists[1], lists[2], lists[3], SOUNDS[start]);
}

// ---- Editing sounds and musics ------------------------------------------

/**
 * Pyxel's Sound.set: notes like "c2e2g2r", tones "tspn", volumes "0"-"7",
 * effects "nsvfhq" and a speed in ticks per note. Spaces are ignored. A
 * sound given MML keeps playing it until mml is cleared.
 */
export function setSound(n: I32, notes: string, tones: string, volumes: string, effects: string, speed: I32): void {
  if (n < 0 || n >= NUM_SOUNDS) return;
  classic[n] = classicCommands(
    parseNotes(notes),
    parseLetters(tones, "tspn"),
    parseLetters(volumes, "01234567"),
    parseLetters(effects, "nsvfhq"),
    speed > 0 ? speed : 1,
  );
}

/**
 * Pyxel's Sound.mml. Text that fails to parse leaves the sound as it was
 * (see mmlError in sdk/sound.ts); text without notes or rests, such as "",
 * makes it a classic sound again.
 */
export function setMml(n: I32, code: string): void {
  if (n < 0 || n >= NUM_SOUNDS) return;
  const commands = parseMml(code);
  if (len(mmlError) === 0) mml[n] = commands;
}

/** Pyxel's Music.set: one list of sound numbers per channel. */
export function setMusic(n: I32, seq0: I32[], seq1: I32[], seq2: I32[], seq3: I32[]): void {
  if (n < 0 || n >= NUM_MUSICS) return;
  musicSeqs[n * NUM_CHANNELS] = seq0;
  musicSeqs[n * NUM_CHANNELS + 1] = seq1;
  musicSeqs[n * NUM_CHANNELS + 2] = seq2;
  musicSeqs[n * NUM_CHANNELS + 3] = seq3;
}

function parseNotes(text: string): I32[] {
  const notes: I32[] = [];
  const codes = codePoints(text);
  // Semitones of a b c d e f g.
  const steps: I32[] = [9, 11, 0, 2, 4, 5, 7];
  let i = 0;
  while (i < len(codes)) {
    const c = lower(codes[i]);
    i++;
    if (c === 114) {
      push(notes, -1);
      continue;
    }
    if (c < 97 || c > 103) continue;
    let note = steps[c - 97];
    if (i < len(codes) && codes[i] === 35) {
      note++;
      i++;
    } else if (i < len(codes) && codes[i] === 45) {
      note--;
      i++;
    }
    if (i < len(codes) && codes[i] >= 48 && codes[i] <= 52) {
      note += (codes[i] - 48) * 12;
      i++;
    }
    push(notes, note);
  }
  return notes;
}

/** Positions of each character of `text` in `alphabet`, skipping others. */
function parseLetters(text: string, alphabet: string): I32[] {
  const values: I32[] = [];
  const letters = codePoints(alphabet);
  for (const code of codePoints(text)) {
    const c = lower(code);
    for (let i = 0; i < len(letters); i++) if (letters[i] === c) push(values, i);
  }
  return values;
}

function lower(code: I32): I32 {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

// A sound plays its MML if it has any, else its classic data. Commands are
// read in place: returning a list would copy it.

function commandCount(n: I32): I32 {
  if (n < 0 || n >= NUM_SOUNDS) return 0;
  return len(mml[n]) > 0 ? len(mml[n]) : len(classic[n]);
}

/** Value `i` of sound n's commands, or 0 past the end. */
function command(n: I32, i: I32): I32 {
  if (len(mml[n]) > 0) return i < len(mml[n]) ? mml[n][i] : 0;
  return i < len(classic[n]) ? classic[n][i] : 0;
}

// ---- Playback ------------------------------------------------------------

/**
 * Plays a list of sounds on a channel. With resume, the playlist the channel
 * was playing continues after the last sound, from where it would be had it
 * kept playing.
 */
export function play(ch: I32, sounds: I32[], loop: boolean, resume: boolean): void {
  if (ch < 0 || ch >= NUM_CHANNELS || len(sounds) === 0) return;
  if (resume) {
    if (!channels[ch].saved && channels[ch].playing) {
      channels[ch].saved = true;
      channels[ch].savedSounds = channels[ch].sounds;
      channels[ch].savedLoop = channels[ch].loop;
    }
  } else {
    channels[ch].saved = false;
    channels[ch].playClock = 0;
  }
  startPlaylist(ch, sounds, loop);
  channels[ch].remaining = 0;
  channels[ch].lastPitch = UNSET;
  channels[ch].playback = 0;
}

function startPlaylist(ch: I32, sounds: I32[], loop: boolean): void {
  channels[ch].sounds = sounds;
  channels[ch].loop = loop;
  channels[ch].sound = 0;
  channels[ch].command = 0;
  channels[ch].soundClock = 0;
  channels[ch].repeatDepth = 0;
  channels[ch].notes = 0;
  channels[ch].playing = true;
}

export function playMusic(n: I32, loop: boolean): void {
  if (n < 0 || n >= NUM_MUSICS) return;
  for (let c = 0; c < NUM_CHANNELS; c++)
    if (len(musicSeqs[n * NUM_CHANNELS + c]) > 0) play(c, musicSeqs[n * NUM_CHANNELS + c], loop, false);
}

/** Stops a channel; its note fades out. A saved resume playlist stays. */
export function stop(ch: I32): void {
  if (ch < 0 || ch >= NUM_CHANNELS) return;
  channels[ch].playing = false;
  channels[ch].noteOn = false;
}

export function isPlaying(ch: I32): boolean {
  return ch >= 0 && ch < NUM_CHANNELS && channels[ch].playing;
}

/** The sound number playing on a channel, or -1. */
export function playingSound(ch: I32): I32 {
  return isPlaying(ch) ? channels[ch].sounds[channels[ch].sound] : -1;
}

/** The index of the note or rest playing in the channel's sound, or -1. */
export function playingNote(ch: I32): I32 {
  return isPlaying(ch) ? channels[ch].notes - 1 : -1;
}

// ---- Commands ------------------------------------------------------------

/**
 * Runs channel c's commands up to its next note or rest and starts it at
 * `remaining` clocks into the current tick. False when the playlist ended.
 */
function nextEvent(c: I32): boolean {
  // Enough steps to pass every sound of a playlist that holds no note or rest.
  let budget = 4096;
  while (budget > 0) {
    budget--;
    const n = channels[c].sounds[channels[c].sound];
    const at = channels[c].command;
    if (at >= commandCount(n)) {
      if (!nextSound(c)) return false;
      continue;
    }
    const op = command(n, at);
    const value = command(n, at + 1);
    channels[c].command = at + commandSize(op, command(n, at + 3));
    if (op === CMD_NOTE) {
      startNote(c, value, command(n, at + 2));
      return true;
    }
    if (op === CMD_REST) {
      const clocks = eventClocks(channels[c].clocksPerTick, value);
      channels[c].remaining += clocks;
      channels[c].soundClock += clocks;
      channels[c].notes++;
      return true;
    }
    if (op === CMD_TEMPO) channels[c].clocksPerTick = value;
    else if (op === CMD_QUANTIZE) channels[c].gate = value;
    else if (op === CMD_TONE) channels[c].tone = value > TONE_NOISE ? 0 : value;
    else if (op === CMD_VOLUME) channels[c].volume = value;
    else if (op === CMD_TRANSPOSE) channels[c].transpose = value;
    else if (op === CMD_DETUNE) channels[c].detune = value;
    else if (op === CMD_ENVELOPE)
      channels[c].envelope = value > 0 && value < SLOTS && envInitial[c * SLOTS + value] >= 0 ? value : -1;
    else if (op === CMD_ENVELOPE_SET) defineEnvelope(c, n, at);
    else if (op === CMD_VIBRATO)
      channels[c].vibrato = value > 0 && value < SLOTS && vibDefined[c * SLOTS + value] ? value : -1;
    else if (op === CMD_VIBRATO_SET) {
      if (value > 0 && value < SLOTS) {
        vibDefined[c * SLOTS + value] = true;
        vibDelay[c * SLOTS + value] = command(n, at + 2);
        vibPeriod[c * SLOTS + value] = command(n, at + 3);
        // Depths beyond four octaves are clamped to keep the pitch math in 32 bits.
        const depth = command(n, at + 4);
        vibDepth[c * SLOTS + value] = depth > 4800 ? 4800 : depth < -4800 ? -4800 : depth;
      }
      channels[c].vibrato = value > 0 && value < SLOTS ? value : -1;
    } else if (op === CMD_GLIDE) {
      if (value > 0 && value < SLOTS && gliDefined[c * SLOTS + value]) selectGlide(c, value);
      else {
        channels[c].glideOn = false;
        channels[c].glidePending = false;
      }
    } else if (op === CMD_GLIDE_SET) {
      if (value > 0 && value < SLOTS) {
        gliDefined[c * SLOTS + value] = true;
        gliOffset[c * SLOTS + value] = command(n, at + 2);
        gliTicks[c * SLOTS + value] = command(n, at + 3);
        selectGlide(c, value);
      } else channels[c].glideOn = false;
    } else if (op === CMD_REPEAT_START) {
      const d = channels[c].repeatDepth;
      if (d < REPEAT_DEPTH) {
        chRepeatAt[c * REPEAT_DEPTH + d] = channels[c].command;
        chRepeatCount[c * REPEAT_DEPTH + d] = 0;
        chRepeatClock[c * REPEAT_DEPTH + d] = channels[c].soundClock;
      }
      channels[c].repeatDepth = d + 1;
    } else if (op === CMD_REPEAT_END) {
      repeatEnd(c, value, commandCount(n));
    }
  }
  channels[c].playing = false;
  return false;
}

function defineEnvelope(c: I32, n: I32, at: I32): void {
  const slot = command(n, at + 1);
  if (slot <= 0 || slot >= SLOTS) {
    channels[c].envelope = -1;
    return;
  }
  const k = c * SLOTS + slot;
  envInitial[k] = command(n, at + 2);
  const count = command(n, at + 3) < SEGMENTS ? command(n, at + 3) : SEGMENTS;
  envCount[k] = count;
  // Segments of at most 65535 ticks (9 minutes at T120) keep the level math in 32 bits.
  for (let s = 0; s < count; s++) {
    const ticks = command(n, at + 4 + 2 * s);
    envTicks[k * SEGMENTS + s] = ticks < 65535 ? ticks : 65535;
    envLevels[k * SEGMENTS + s] = command(n, at + 5 + 2 * s);
  }
  channels[c].envelope = slot;
}

/** Enables glide slot `slot`: fixed offset and length, or resolved at each note. */
function selectGlide(c: I32, slot: I32): void {
  const offset = gliOffset[c * SLOTS + slot],
    ticks = gliTicks[c * SLOTS + slot];
  channels[c].glideOn = true;
  if (offset !== UNSET && ticks !== UNSET) {
    channels[c].glidePending = false;
    channels[c].glideOffset = centsTo64ths(offset);
    channels[c].glideTicks = ticks;
  } else {
    channels[c].glidePending = true;
    channels[c].pendingOffset = offset;
    channels[c].pendingTicks = ticks;
  }
}

function centsTo64ths(cents: I32): I32 {
  const scaled = cents * 16;
  return scaled >= 0 ? idiv(scaled + 12, 25) : -idiv(-scaled + 12, 25);
}

/** `]n`: back to the matching `[` until the body has played n times (0: for ever). */
function repeatEnd(c: I32, count: I32, end: I32): void {
  const d = channels[c].repeatDepth - 1;
  if (d < 0) return;
  if (d >= REPEAT_DEPTH) {
    channels[c].repeatDepth = d;
    return;
  }
  const k = c * REPEAT_DEPTH + d;
  if (channels[c].soundClock === chRepeatClock[k]) {
    // A pass that took no time would repeat for ever: leave the loop, or the sound.
    channels[c].repeatDepth = d;
    if (count === 0) channels[c].command = end;
    return;
  }
  if (count === 0 || chRepeatCount[k] + 1 < count) {
    chRepeatCount[k]++;
    chRepeatClock[k] = channels[c].soundClock;
    channels[c].command = chRepeatAt[k];
  } else channels[c].repeatDepth = d;
}

/** Moves to the next sound; at the end of the playlist loops, resumes or stops. */
function nextSound(c: I32): boolean {
  channels[c].sound++;
  channels[c].command = 0;
  channels[c].soundClock = 0;
  channels[c].repeatDepth = 0;
  channels[c].notes = 0;
  if (channels[c].sound < len(channels[c].sounds)) return true;
  if (channels[c].loop) {
    channels[c].sound = 0;
    // The playlist starts over at this moment.
    channels[c].playClock = -channels[c].remaining;
    return true;
  }
  if (channels[c].saved) {
    resumeSaved(c);
    return true;
  }
  channels[c].playing = false;
  return false;
}

/** Continues a playlist a sound effect interrupted, where it would be by now. */
function resumeSaved(c: I32): void {
  channels[c].saved = false;
  let position = channels[c].playClock + channels[c].remaining;
  const total = playlistClocks(channels[c].savedSounds);
  if (channels[c].savedLoop && total > 0) position = position % total;
  startPlaylist(c, channels[c].savedSounds, channels[c].savedLoop);
  // Events before `position` run silently as the next ticks catch up.
  channels[c].playClock = position - channels[c].remaining;
  channels[c].remaining -= position;
}

/**
 * Clocks one pass of a playlist lasts, following tempos and repeats; -1 when
 * it repeats for ever or is too long to count.
 */
function playlistClocks(sounds: I32[]): I32 {
  let perTick = 18643,
    total = 0;
  const repeatAt: I32[] = fill(REPEAT_DEPTH, 0),
    repeatCount: I32[] = fill(REPEAT_DEPTH, 0),
    repeatClock: I32[] = fill(REPEAT_DEPTH, 0);
  for (let s = 0; s < len(sounds); s++) {
    const n = sounds[s];
    let at = 0,
      depth = 0,
      clock = 0,
      steps = 0;
    while (at < commandCount(n)) {
      steps++;
      if (steps > 100000) return -1;
      const op = command(n, at),
        value = command(n, at + 1);
      const next = at + commandSize(op, command(n, at + 3));
      if (op === CMD_TEMPO) perTick = value;
      else if (op === CMD_NOTE || op === CMD_REST) {
        const ticks = op === CMD_NOTE ? command(n, at + 2) : value;
        if (ticks > idiv(2000000000 - clock, perTick)) return -1;
        clock += perTick * ticks;
      } else if (op === CMD_REPEAT_START) {
        if (depth < REPEAT_DEPTH) {
          repeatAt[depth] = next;
          repeatCount[depth] = 0;
          repeatClock[depth] = clock;
        }
        depth++;
      } else if (op === CMD_REPEAT_END && depth > 0) {
        depth--;
        if (depth < REPEAT_DEPTH && clock !== repeatClock[depth]) {
          if (value === 0) return -1;
          if (repeatCount[depth] + 1 < value) {
            repeatCount[depth]++;
            repeatClock[depth] = clock;
            depth++;
            at = repeatAt[depth - 1];
            continue;
          }
        }
      }
      at = next;
    }
    if (clock > 2000000000 - total) return -1;
    total += clock;
  }
  return total;
}

/** Clocks of `ticks` ticks, capped far beyond any tune's longest note. */
function eventClocks(perTick: I32, ticks: I32): I32 {
  return ticks < idiv(MAX_EVENT_CLOCKS, perTick) ? perTick * ticks : MAX_EVENT_CLOCKS;
}

/** Starts a note at `remaining` clocks into the current tick. */
function startNote(c: I32, midi: I32, ticks: I32): void {
  const perTick = channels[c].clocksPerTick;
  const pitch = (midi + channels[c].transpose) * 64 + centsTo64ths(channels[c].detune);
  const clocks = eventClocks(perTick, ticks);
  if (channels[c].glidePending) {
    const last = channels[c].lastPitch !== UNSET ? channels[c].lastPitch : pitch;
    channels[c].glideOffset =
      channels[c].pendingOffset !== UNSET ? centsTo64ths(channels[c].pendingOffset) : last - pitch;
    channels[c].glideTicks = channels[c].pendingTicks !== UNSET ? channels[c].pendingTicks : ticks;
  }
  channels[c].noteOn = true;
  channels[c].notePitch = pitch;
  channels[c].noteVolume = channels[c].volume;
  // Gate clocks: clocks * gate / 100, rounded, without overflowing.
  channels[c].noteGate = idiv(clocks, 100) * channels[c].gate + idiv((clocks % 100) * channels[c].gate + 50, 100);
  channels[c].noteElapsed = -channels[c].remaining;
  // Tick time advances by a fixed step per audio tick, so ticks cost no division.
  const elapsed = channels[c].noteElapsed;
  channels[c].noteFine = idiv(elapsed, perTick) * 256 + idiv((elapsed % perTick) * 256, perTick);
  channels[c].fineStep = idiv(TICK_CLOCKS * 256, perTick);
  channels[c].lastPitch = pitch;
  channels[c].remaining += clocks;
  channels[c].soundClock += clocks;
  channels[c].notes++;
}

// ---- Ticks ---------------------------------------------------------------

/** Advances every channel by `ticks` audio ticks and emits their voices. */
export function advance(ticks: I32): void {
  for (let t = 0; t < ticks; t++) {
    let clocks = TICK_CLOCKS;
    tickRemainder += TICK_REMAINDER;
    if (tickRemainder >= TICK_UNIT) {
      tickRemainder -= TICK_UNIT;
      clocks++;
    }
    for (let c = 0; c < NUM_CHANNELS; c++) tickChannel(c, clocks);
  }
}

/** Emits channel c's voice for a tick of `clocks` clocks, then moves it forward. */
function tickChannel(c: I32, clocks: I32): void {
  const half = clocks >> 1;
  // Events that start in the first half of the tick sound from its start.
  while (channels[c].playing && channels[c].remaining <= half) if (!nextEvent(c)) break;
  emitVoice(c, channels[c].noteElapsed + half);
  channels[c].noteElapsed += clocks;
  channels[c].noteFine += channels[c].fineStep;
  if (channels[c].playing) {
    channels[c].remaining -= clocks;
    channels[c].playClock += clocks;
  }
}

function emitVoice(c: I32, t: I32): void {
  if (!channels[c].noteOn || t < 0 || t >= channels[c].noteGate) {
    if (channels[c].noteOn && t >= channels[c].noteGate) channels[c].noteOn = false;
    pushVoice(-1, 0, 0);
    return;
  }
  // Time into the note at the middle of the tick, in 1/256 ticks and whole ticks.
  const middle = channels[c].noteFine + (channels[c].fineStep >> 1);
  const fine = middle > 0 ? middle : 0;
  const tick = fine >> 8;
  const tone = channels[c].tone;
  const level = envelope(c, fine);
  const amp = idiv(idiv(TONE_AMP[tone] * level, 127) * channels[c].noteVolume, 1048576);
  const pitch = channels[c].notePitch + vibrato(c, tick) + glide(c, tick);
  pushVoice(tone, step(pitch, tone), amp);
  channels[c].playback += channels[c].fineStep;
}

/** Envelope level of channel c's note at `fine` 1/256 ticks, in 1/256 of 127. */
function envelope(c: I32, fine: I32): I32 {
  const slot = channels[c].envelope;
  if (slot < 0) return FULL_LEVEL;
  const k = c * SLOTS + slot;
  let level = envInitial[k],
    start = 0;
  for (let s = 0; s < envCount[k]; s++) {
    const ticks = envTicks[k * SEGMENTS + s],
      target = envLevels[k * SEGMENTS + s];
    // Straight from the previous level to the target over the segment.
    if (fine < start + ticks * 256) return level * 256 + idiv((target - level) * (fine - start), ticks);
    start += ticks * 256;
    level = target;
  }
  return level * 256;
}

/** Vibrato in 1/64 semitones: a triangle starting at 0 and rising, per whole tick. */
function vibrato(c: I32, tick: I32): I32 {
  const slot = channels[c].vibrato;
  if (slot < 0) return 0;
  const k = c * SLOTS + slot;
  const period = vibPeriod[k];
  if (period <= 0) return 0;
  let x = 0;
  if (vibDelay[k] > 0) {
    if (tick < vibDelay[k]) return 0;
    x = ((tick - vibDelay[k]) % period) * 256;
  } else x = channels[c].playback % (period * 256);
  // Phase in 1/4096 of a period; modulation 1 - 4 |frac(phase + 1/4) - 1/2| in 1/4096.
  const phase = (idiv(x * 16, period) + 1024) & 4095;
  const distance = phase - 2048;
  const modulation = 4096 - 4 * (distance < 0 ? -distance : distance);
  return idiv(modulation * vibDepth[k] * 64, 409600);
}

/** Glide in 1/64 semitones: the offset shrinking to 0 over the glide's ticks. */
function glide(c: I32, tick: I32): I32 {
  if (!channels[c].glideOn) return 0;
  const ticks = channels[c].glideTicks;
  if (ticks <= 0 || tick >= ticks) return 0;
  return idiv(channels[c].glideOffset * (ticks - tick), ticks);
}

/** Phase step for a pitch in 1/64 semitones, interpolating the note table. */
function step(pitch: I32, tone: I32): I32 {
  const note = pitch >> 6;
  const last = len(noteSteps) - 1;
  if (note < 0) return noteSteps[0];
  if (note >= last) return noteSteps[last];
  const low = noteSteps[note],
    high = noteSteps[note + 1];
  const value = low + idiv((high - low) * (pitch & 63), 64);
  // Noise advances its shift register once per waveform period, not 32 times.
  return tone === TONE_NOISE ? value >> 5 : value;
}
