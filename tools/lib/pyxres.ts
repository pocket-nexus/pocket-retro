/**
 * Pyxel resource files: .pyxres archives (format 3 TOML, and the older
 * per-item text entries) and .pyxpal palettes. Mirrors pyxel-core
 * resource_data.rs and old_resource_data.rs.
 */
import { existsSync, readFileSync } from "node:fs";
import { readZip } from "./zip.ts";

export const IMAGE_SIZE = 256;
export const TILEMAP_SIZE = 256;
export const NUM_IMAGES = 3;
export const NUM_TILEMAPS = 8;
export const NUM_SOUNDS = 64;
export const NUM_MUSICS = 8;

export interface Sound {
  notes: number[];
  tones: number[];
  volumes: number[];
  effects: number[];
  speed: number;
}

export interface Resource {
  /** Three 256 x 256 banks of palette indices, row-major. */
  images: Uint8Array[];
  /** Eight 256 x 256 tilemaps of (tile x, tile y) byte pairs, row-major. */
  tilemaps: Uint8Array[];
  tilemapImages: number[];
  sounds: (Sound | undefined)[];
  /** Per music, four channel sequences of sound numbers. */
  musics: (number[][] | undefined)[];
  /** Colors from the .pyxpal next to the resource file, if one exists. */
  colors?: number[];
}

export function emptyResource(): Resource {
  return {
    images: Array.from({ length: NUM_IMAGES }, () => new Uint8Array(IMAGE_SIZE * IMAGE_SIZE)),
    tilemaps: Array.from({ length: NUM_TILEMAPS }, () => new Uint8Array(TILEMAP_SIZE * TILEMAP_SIZE * 2)),
    tilemapImages: Array(NUM_TILEMAPS).fill(0),
    sounds: Array(NUM_SOUNDS).fill(undefined),
    musics: Array(NUM_MUSICS).fill(undefined),
  };
}

/** Rows of a compressed grid, each padded with its last value, then padded with the last row. */
function expand(rows: number[][], height: number, width: number): number[][] {
  const out = rows.slice(0, height).map((row) => {
    const padded = row.slice(0, width);
    while (padded.length < width) padded.push(row.at(-1) ?? 0);
    return padded;
  });
  while (out.length < height) out.push([...(out.at(-1) ?? Array(width).fill(0))]);
  return out;
}

export function readPalette(path: string): number[] | undefined {
  if (!existsSync(path)) return undefined;
  const colors = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const value = Number.parseInt(line, 16);
      if (!Number.isFinite(value)) throw new Error(`${path}: invalid color ${line}`);
      return value & 0xffffff;
    });
  return colors.length ? colors : [0xffffff];
}

export function readResource(path: string): Resource {
  const files = readZip(readFileSync(path));
  const resource = emptyResource();
  const toml = files.get("pyxel_resource.toml");
  if (toml) readToml(new TextDecoder().decode(toml), resource, path);
  else if (files.has("pyxel_resource/version")) readLegacy(files, resource, path);
  else throw new Error(`${path}: not a Pyxel resource file`);
  resource.colors = readPalette(path.replace(/\.pyxres$/i, "") + ".pyxpal");
  return resource;
}

function readToml(text: string, resource: Resource, path: string) {
  const data = Bun.TOML.parse(text) as {
    format_version?: number;
    images?: { width: number; height: number; data: number[][] }[];
    tilemaps?: { width: number; height: number; imgsrc: number; data: number[][] }[];
    sounds?: Sound[];
    musics?: { seqs: number[][] }[];
  };
  if ((data.format_version ?? 0) > 4) throw new Error(`${path}: unsupported resource format ${data.format_version}`);
  (data.images ?? []).slice(0, NUM_IMAGES).forEach((image, index) => {
    const rows = expand(image.data, image.height, image.width);
    const bank = resource.images[index]!;
    rows.forEach((row, y) => {
      if (y < IMAGE_SIZE) row.forEach((value, x) => x < IMAGE_SIZE && (bank[y * IMAGE_SIZE + x] = value));
    });
  });
  (data.tilemaps ?? []).slice(0, NUM_TILEMAPS).forEach((tilemap, index) => {
    const rows = expand(tilemap.data, tilemap.height, tilemap.width * 2);
    const map = resource.tilemaps[index]!;
    rows.forEach((row, y) => {
      if (y < TILEMAP_SIZE)
        for (let x = 0; x < Math.min(tilemap.width, TILEMAP_SIZE); x++) {
          map[(y * TILEMAP_SIZE + x) * 2] = row[x * 2]!;
          map[(y * TILEMAP_SIZE + x) * 2 + 1] = row[x * 2 + 1]!;
        }
    });
    resource.tilemapImages[index] = tilemap.imgsrc ?? 0;
  });
  (data.sounds ?? []).slice(0, NUM_SOUNDS).forEach((sound, index) => {
    resource.sounds[index] = {
      notes: sound.notes ?? [],
      tones: sound.tones ?? [],
      volumes: sound.volumes ?? [],
      effects: sound.effects ?? [],
      speed: sound.speed ?? 30,
    };
  });
  (data.musics ?? []).slice(0, NUM_MUSICS).forEach((music, index) => {
    const seqs = (music.seqs ?? []).slice(0, 4).map((seq) => [...seq]);
    while (seqs.length < 4) seqs.push([]);
    resource.musics[index] = seqs;
  });
}

function hexGroups(line: string, width: number): number[] {
  const values: number[] = [];
  for (let i = 0; i + width <= line.length; i += width) values.push(Number.parseInt(line.slice(i, i + width), 16));
  return values;
}

function readLegacy(files: Map<string, Uint8Array>, resource: Resource, path: string) {
  const text = (name: string) => {
    const bytes = files.get(`pyxel_resource/${name}`);
    return bytes ? new TextDecoder().decode(bytes) : undefined;
  };
  const [major = 0, minor = 0, patch = 0] = (text("version") ?? "0").trim().split(".").map(Number);
  const version = major * 10000 + minor * 100 + patch;
  for (let index = 0; index < NUM_IMAGES; index++) {
    const lines = text(`image${index}`)?.split(/\r?\n/) ?? [];
    lines.slice(0, IMAGE_SIZE).forEach((line, y) => {
      [...line]
        .slice(0, IMAGE_SIZE)
        .forEach((digit, x) => (resource.images[index]![y * IMAGE_SIZE + x] = Number.parseInt(digit, 16)));
    });
  }
  for (let index = 0; index < NUM_TILEMAPS; index++) {
    const lines = text(`tilemap${index}`)?.split(/\r?\n/) ?? [];
    const group = version < 10500 ? 3 : 4;
    lines.slice(0, TILEMAP_SIZE).forEach((line, y) => {
      hexGroups(line, group)
        .slice(0, TILEMAP_SIZE)
        .forEach((tile, x) => {
          const [tx, ty] = version < 10500 ? [tile % 32, Math.floor(tile / 32)] : [(tile >> 8) & 0xff, tile & 0xff];
          resource.tilemaps[index]![(y * TILEMAP_SIZE + x) * 2] = tx;
          resource.tilemaps[index]![(y * TILEMAP_SIZE + x) * 2 + 1] = ty;
        });
    });
    if (lines[TILEMAP_SIZE]?.trim()) resource.tilemapImages[index] = Number(lines[TILEMAP_SIZE]);
  }
  for (let index = 0; index < NUM_SOUNDS; index++) {
    const lines = text(`sound${String(index).padStart(2, "0")}`)?.split(/\r?\n/);
    if (!lines) continue;
    const field = (i: number, width: number) => (lines[i] && lines[i] !== "none" ? hexGroups(lines[i]!, width) : []);
    resource.sounds[index] = {
      notes: field(0, 2).map((value) => (value > 127 ? value - 256 : value)),
      tones: field(1, 1),
      volumes: field(2, 1),
      effects: field(3, 1),
      speed: Number(lines[4] ?? 30) || 30,
    };
  }
  for (let index = 0; index < NUM_MUSICS; index++) {
    const lines = text(`music${index}`)?.split(/\r?\n/);
    if (!lines) continue;
    resource.musics[index] = Array.from({ length: 4 }, (_, c) =>
      lines[c] && lines[c] !== "none" ? hexGroups(lines[c]!, 2) : [],
    );
  }
  if (!text("version")) throw new Error(`${path}: legacy resource without a version`);
}
