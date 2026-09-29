// Replaced at build time by tools/lib/assets.ts with the game's baked
// resources. This stub keeps the SDK type-checkable in the repository.
import type { i32, u8 } from "@pocketjs/framework/solid/std";

/** Image banks 0-2, 256 x 256 palette indices each, row-major. */
export const IMAGES: u8[] = [];
/** Tilemaps 0-7, 256 x 256 tiles of (image tile x, image tile y) byte pairs. */
export const TILEMAPS: u8[] = [];
/** The image bank each tilemap draws from. */
export const TILEMAP_IMAGES: i32[] = [];
/** Display colors from the resource's .pyxpal; empty keeps the defaults. */
export const COLORS: i32[] = [];
/** Sounds as records: speed, then four lengths, then notes, tones, volumes, effects. */
export const SOUNDS: i32[] = [];
/** Start of each sound's record in SOUNDS, or -1. */
export const SOUND_STARTS: i32[] = [];
/** Musics as records: four sequence lengths, then the sequences' sound numbers. */
export const MUSICS: i32[] = [];
/** Start of each music's record in MUSICS, or -1. */
export const MUSIC_STARTS: i32[] = [];
