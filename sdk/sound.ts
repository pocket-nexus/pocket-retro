/**
 * Sounds as command lists, the form pyxel-core plays. Sound.set's notes,
 * tones, volumes and effects (sound.rs) and Sound.mml's text (mml_parser.rs)
 * both become the commands below, which sdk/audio.ts executes. A list is one
 * flat array: each command is its opcode followed by its arguments.
 */
import { codePoints, idiv, len, push, type i32 as I32 } from "@pocketjs/framework/solid/std";

/** Clocks per tick. */
export const CMD_TEMPO: I32 = 1;
/** Gate, in percent of each note's length. */
export const CMD_QUANTIZE: I32 = 2;
/** Tone number. */
export const CMD_TONE: I32 = 3;
/** Volume, 4096 = 1.0. */
export const CMD_VOLUME: I32 = 4;
/** Semitones. */
export const CMD_TRANSPOSE: I32 = 5;
/** Cents. */
export const CMD_DETUNE: I32 = 6;
/** Slot; an undefined slot or 0 disables the envelope. */
export const CMD_ENVELOPE: I32 = 7;
/** Slot, initial level (0-127), segment count, then ticks and target level per segment. */
export const CMD_ENVELOPE_SET: I32 = 8;
export const CMD_VIBRATO: I32 = 9;
/** Slot, delay ticks, period ticks, depth in cents. */
export const CMD_VIBRATO_SET: I32 = 10;
export const CMD_GLIDE: I32 = 11;
/** Slot, offset in cents or UNSET, duration in ticks or UNSET. */
export const CMD_GLIDE_SET: I32 = 12;
/** MIDI note, ticks. */
export const CMD_NOTE: I32 = 13;
/** Ticks. */
export const CMD_REST: I32 = 14;
export const CMD_REPEAT_START: I32 = 15;
/** Times the body plays in all, 0 for ever. */
export const CMD_REPEAT_END: I32 = 16;

/** An argument written `*` in MML: resolved at each note. */
export const UNSET: I32 = -2147483647;
/** Pyxel's clock: timing is whole numbers of these per second. */
export const CLOCK_RATE: I32 = 1789773;
/** Clocks per tick of classic sounds, 120 ticks a second. */
const CLASSIC_CLOCKS_PER_TICK: I32 = 14914;
const TICKS_PER_WHOLE: I32 = 192;

/**
 * Number of values a command occupies, given its opcode and the value three
 * places after it (an envelope's segment count).
 */
export function commandSize(op: I32, third: I32): I32 {
  if (op === CMD_ENVELOPE_SET) return 4 + 2 * third;
  if (op === CMD_VIBRATO_SET) return 5;
  if (op === CMD_GLIDE_SET) return 4;
  if (op === CMD_NOTE) return 3;
  if (op === CMD_REPEAT_START) return 1;
  return 2;
}

// ---- Sound.set -----------------------------------------------------------

const TONE_NOISE: I32 = 3;
const EFFECT_SLIDE: I32 = 1;
const EFFECT_VIBRATO: I32 = 2;
const EFFECT_FADEOUT: I32 = 3;
const EFFECT_HALF_FADEOUT: I32 = 4;
const EFFECT_QUARTER_FADEOUT: I32 = 5;

function contains(values: I32[], value: I32): boolean {
  for (let i = 0; i < len(values); i++) if (values[i] === value) return true;
  return false;
}

/**
 * The commands of a classic sound, as sound.rs emits them: a header that
 * defines envelopes for the fade effects in use, the slide as a glide from
 * the previous note and the vibrato as a 20-tick, 25-cent vibrato, then per
 * note the tone, volume and effect slots that changed and the note itself.
 * Notes are 0-59 above C0; -1 is a rest.
 */
export function classicCommands(notes: I32[], tones: I32[], volumes: I32[], effects: I32[], speed: I32): I32[] {
  const out: I32[] = [CMD_TEMPO, CLASSIC_CLOCKS_PER_TICK, CMD_QUANTIZE, 100, CMD_TRANSPOSE, 0, CMD_DETUNE, 0];
  if (contains(effects, EFFECT_FADEOUT)) {
    for (const v of [CMD_ENVELOPE_SET, 1, 127, 1, speed, 0]) push(out, v);
  }
  if (contains(effects, EFFECT_HALF_FADEOUT)) {
    const fade = (speed + 1) >> 1;
    for (const v of [CMD_ENVELOPE_SET, 2, 127, 2, speed - fade, 127, fade, 0]) push(out, v);
  }
  if (contains(effects, EFFECT_QUARTER_FADEOUT)) {
    const fade = (speed + 2) >> 2;
    for (const v of [CMD_ENVELOPE_SET, 3, 127, 2, speed - fade, 127, fade, 0]) push(out, v);
  }
  if (contains(effects, EFFECT_VIBRATO)) for (const v of [CMD_VIBRATO_SET, 1, 0, 20, 25]) push(out, v);
  else for (const v of [CMD_VIBRATO, 0]) push(out, v);
  if (contains(effects, EFFECT_SLIDE)) for (const v of [CMD_GLIDE_SET, 1, UNSET, UNSET]) push(out, v);
  else for (const v of [CMD_GLIDE, 0]) push(out, v);

  let tone = -1,
    volume = -1,
    envelope = -1,
    vibrato = -1,
    glide = -1;
  for (let i = 0; i < len(notes); i++) {
    if (notes[i] < 0) {
      push(out, CMD_REST);
      push(out, speed);
      continue;
    }
    const t = len(tones) > 0 ? tones[i % len(tones)] : 0;
    const v = len(volumes) > 0 ? volumes[i % len(volumes)] : 7;
    const e = len(effects) > 0 ? effects[i % len(effects)] : 0;
    const env = e === EFFECT_FADEOUT ? 1 : e === EFFECT_HALF_FADEOUT ? 2 : e === EFFECT_QUARTER_FADEOUT ? 3 : 0;
    const vib = e === EFFECT_VIBRATO ? 1 : 0;
    const gli = e === EFFECT_SLIDE ? 1 : 0;
    if (t !== tone) {
      tone = t;
      push(out, CMD_TONE);
      push(out, t);
    }
    if (v !== volume) {
      volume = v;
      push(out, CMD_VOLUME);
      push(out, idiv(v * 4096 + 3, 7));
    }
    if (env !== envelope) {
      envelope = env;
      push(out, CMD_ENVELOPE);
      push(out, env);
    }
    if (vib !== vibrato) {
      vibrato = vib;
      push(out, CMD_VIBRATO);
      push(out, vib);
    }
    if (gli !== glide) {
      glide = gli;
      push(out, CMD_GLIDE);
      push(out, gli);
    }
    push(out, CMD_NOTE);
    push(out, notes[i] + (t === TONE_NOISE ? 60 : 36));
    push(out, speed);
  }
  return out;
}

// ---- Sound.mml -----------------------------------------------------------

/** The last parse error as "MML:<offset>: <message>", or "". */
export let mmlError: string = "";

let text: I32[] = [];
let at: I32 = 0;
let out: I32[] = [];
let failed: boolean = false;
let found: boolean = false;

// Parser state (mml_parser.rs): octave, default length, quantize, tie.
let octave: I32 = 4;
let defaultTicks: I32 = 48;
let quantize: I32 = 80;
let connected: boolean = false;
let tiedMidi: I32 = 0;
let tiedTicksAt: I32 = 0;
let noteSeen: boolean = false;
let depth: I32 = 0;
/** Command kinds seen so far, which the first note does not default. */
let seen: boolean[] = [];

function fail(message: string): void {
  if (!failed) mmlError = "MML:" + String(at) + ": " + message;
  failed = true;
}

function isSpace(c: I32): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

function upper(c: I32): I32 {
  return c >= 97 && c <= 122 ? c - 32 : c;
}

/** The next character after whitespace, upper case, or -1 at the end. */
function peek(): I32 {
  while (at < len(text) && isSpace(text[at])) at++;
  return at < len(text) ? upper(text[at]) : -1;
}

/** Consumes `word` (upper case) when it follows immediately, as after "@". */
function keyword(word: string): boolean {
  const codes = codePoints(word);
  if (at + len(codes) > len(text)) return false;
  for (let i = 0; i < len(codes); i++) if (upper(text[at + i]) !== codes[i]) return false;
  at += len(codes);
  return true;
}

/** An optional integer; `found` tells whether one was there. Saturates at 2^31 - 1. */
function number(): I32 {
  found = false;
  const start = at;
  let c = peek();
  let negative = false;
  if (c === 45) {
    negative = true;
    at++;
    c = at < len(text) ? text[at] : -1;
  }
  if (c < 48 || c > 57) {
    at = start;
    return 0;
  }
  let value = 0;
  while (at < len(text) && text[at] >= 48 && text[at] <= 57) {
    const digit = text[at] - 48;
    value = value > idiv(2147483647 - digit, 10) ? 2147483647 : value * 10 + digit;
    at++;
  }
  found = true;
  return negative ? -value : value;
}

/** A required integer in lower..upper. */
function required(name: string, lower: I32, upperBound: I32): I32 {
  const value = number();
  if (!found) fail("Missing value for '" + name + "'");
  else if (value < lower || value > upperBound) fail("Invalid value for '" + name + "'");
  return value;
}

function expect(code: I32, message: string): void {
  if (peek() === code) at++;
  else fail(message);
}

/** Ticks of an optional length (1-192, dividing 192) and dots, starting from `base`. */
function lengthTicks(base: I32): I32 {
  const value = number();
  let ticks = base;
  if (found) {
    if (value < 1 || value > TICKS_PER_WHOLE || TICKS_PER_WHOLE % value !== 0) {
      fail("Invalid note length");
      return base;
    }
    ticks = idiv(TICKS_PER_WHOLE, value);
  }
  let dot = ticks;
  while (peek() === 46) {
    at++;
    if (dot % 2 !== 0) {
      fail("Cannot apply dot to odd note length");
      return ticks;
    }
    dot = dot >> 1;
    ticks += dot;
  }
  return ticks;
}

function emit(op: I32, value: I32): void {
  push(out, op);
  push(out, value);
}

/** Before the first note, a default for every command kind the text has not set. */
function insertDefaults(): void {
  const defaults: I32[] = [CMD_TEMPO, 18643, CMD_QUANTIZE, 80, CMD_TONE, 0, CMD_VOLUME, 3225, CMD_TRANSPOSE, 0];
  for (let i = 0; i < len(defaults); i += 2) if (!seen[defaults[i]]) emit(defaults[i], defaults[i + 1]);
  if (!seen[CMD_DETUNE]) emit(CMD_DETUNE, 0);
  if (!seen[CMD_ENVELOPE]) emit(CMD_ENVELOPE, 0);
  if (!seen[CMD_VIBRATO]) emit(CMD_VIBRATO, 0);
  if (!seen[CMD_GLIDE]) emit(CMD_GLIDE, 0);
  for (let i = 0; i < len(seen); i++) seen[i] = true;
}

function note(midi: I32): void {
  let ticks = lengthTicks(defaultTicks);
  let tieNext = false;
  // "&" and a length lengthen the note; "&" alone ties or slurs it to the next.
  while (!failed && peek() === 38) {
    at++;
    const c = peek();
    if (c >= 48 && c <= 57) ticks += lengthTicks(0);
    else {
      tieNext = true;
      break;
    }
  }
  if (connected && midi === tiedMidi) {
    out[tiedTicksAt] += ticks;
  } else {
    if (!noteSeen) insertDefaults();
    noteSeen = true;
    if (quantize !== 100) emit(CMD_QUANTIZE, tieNext ? 100 : quantize);
    push(out, CMD_NOTE);
    push(out, midi);
    push(out, ticks);
    tiedTicksAt = len(out) - 1;
    tiedMidi = midi;
  }
  connected = tieNext;
}

function rest(): void {
  if (connected) {
    fail("Tie '&' is not followed by a note");
    return;
  }
  let ticks = lengthTicks(defaultTicks);
  while (!failed && peek() === 38) {
    at++;
    const c = peek();
    if (c < 48 || c > 57) fail("Invalid rest length");
    else ticks += lengthTicks(0);
  }
  if (!noteSeen && !seen[CMD_TEMPO]) emit(CMD_TEMPO, 18643);
  seen[CMD_TEMPO] = true;
  emit(CMD_REST, ticks);
}

/** @ENV, @VIB or @GLI: a slot to select, or a slot and its definition in braces. */
function slotCommand(select: I32, define: I32, name: string): void {
  const slot = required(name, 0, 2147483647);
  seen[select] = true;
  if (peek() !== 123) {
    emit(select, slot);
    return;
  }
  at++;
  if (slot === 0) fail(name + " slot 0 is reserved for disable");
  push(out, define);
  push(out, slot);
  if (define === CMD_ENVELOPE_SET) {
    push(out, required(name, 0, 127));
    const countAt = len(out);
    push(out, 0);
    while (!failed && peek() === 44) {
      at++;
      push(out, required(name, 0, 2147483647));
      expect(44, "Missing envelope level");
      push(out, required(name, 0, 127));
      out[countAt]++;
    }
  } else if (define === CMD_VIBRATO_SET) {
    push(out, required(name, 0, 2147483647));
    expect(44, "Missing vibrato period");
    push(out, required(name, 0, 2147483647));
    expect(44, "Missing vibrato depth");
    push(out, required(name, -2147483647, 2147483647));
  } else {
    for (let i = 0; i < 2; i++) {
      if (i > 0) expect(44, "Missing glide duration");
      if (peek() === 42) {
        at++;
        push(out, UNSET);
      } else push(out, required(name, i === 0 ? -2147483647 : 0, 2147483647));
    }
  }
  expect(125, "Missing '}'");
}

/**
 * Parses Pyxel's MML (mml_parser.rs) into commands. Returns false and sets
 * mmlError on a syntax error. Octaves, lengths and ties are resolved here;
 * a default for each setting the text leaves out goes before its first note.
 */
export function parseMml(code: string): I32[] {
  text = codePoints(code);
  at = 0;
  out = [];
  failed = false;
  mmlError = "";
  octave = 4;
  defaultTicks = 48;
  quantize = 80;
  connected = false;
  noteSeen = false;
  depth = 0;
  seen = [];
  for (let i = 0; i <= CMD_REPEAT_END; i++) push(seen, false);
  // Semitones of C D E F G A B.
  const steps: I32[] = [9, 11, 0, 2, 4, 5, 7];

  while (!failed) {
    const c = peek();
    if (c < 0) break;
    at++;
    if (c === 84) {
      // Beats per minute as clocks per tick, rounded; far beyond any tune's tempo, T saturates.
      const bpm = required("T", 1, 2147483647);
      const d = (bpm < 1000000 ? bpm : 1000000) * 48;
      const perTick = idiv(107386380 + (d >> 1), d);
      emit(CMD_TEMPO, perTick > 1 ? perTick : 1);
      seen[CMD_TEMPO] = true;
    } else if (c === 81) {
      quantize = required("Q", 0, 100);
      emit(CMD_QUANTIZE, quantize);
      seen[CMD_QUANTIZE] = true;
    } else if (c === 86) {
      emit(CMD_VOLUME, idiv(required("V", 0, 127) * 4096 + 63, 127));
      seen[CMD_VOLUME] = true;
    } else if (c === 75) {
      emit(CMD_TRANSPOSE, required("K", -2147483647, 2147483647));
      seen[CMD_TRANSPOSE] = true;
    } else if (c === 89) {
      emit(CMD_DETUNE, required("Y", -2147483647, 2147483647));
      seen[CMD_DETUNE] = true;
    } else if (c === 64) {
      if (keyword("ENV")) slotCommand(CMD_ENVELOPE, CMD_ENVELOPE_SET, "@ENV");
      else if (keyword("VIB")) slotCommand(CMD_VIBRATO, CMD_VIBRATO_SET, "@VIB");
      else if (keyword("GLI")) slotCommand(CMD_GLIDE, CMD_GLIDE_SET, "@GLI");
      else {
        emit(CMD_TONE, required("@", 0, 255));
        seen[CMD_TONE] = true;
      }
    } else if (c === 79) {
      octave = required("O", -1, 9);
    } else if (c === 62) {
      if (octave >= 9) fail("Octave out of range");
      else octave++;
    } else if (c === 60) {
      if (octave <= -1) fail("Octave out of range");
      else octave--;
    } else if (c === 76) {
      defaultTicks = lengthTicks(defaultTicks);
    } else if (c >= 65 && c <= 71) {
      let midi = (octave + 1) * 12 + steps[c - 65];
      const accidental = peek();
      if (accidental === 35 || accidental === 43) {
        midi++;
        at++;
      } else if (accidental === 45) {
        midi--;
        at++;
      }
      note(midi < 0 ? 0 : midi);
    } else if (c === 82) {
      rest();
    } else if (c === 91) {
      push(out, CMD_REPEAT_START);
      depth++;
    } else if (c === 93) {
      if (depth <= 0) fail("Unmatched ']'");
      depth--;
      const count = number();
      emit(CMD_REPEAT_END, found ? count : 0);
    } else {
      at--;
      fail("Unexpected character");
    }
  }
  if (!failed && depth > 0) fail("Unmatched '['");
  if (!failed && connected) fail("Tie '&' is not followed by a note");
  return failed ? [] : out;
}
