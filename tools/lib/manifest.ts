/** `pyxel.json`: how the build tools find a game's entry and resources. */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export interface Manifest {
  /** Cartridge title, at most 12 characters. */
  title: string;
  /** Four-character game code. */
  code: string;
  /** Module exporting setup(), update() and draw(); default "game.ts". */
  entry: string;
  /** A .pyxres file whose images, tilemaps, sounds and musics the game starts with. */
  resources?: string;
  /** A .pyxpal file of display colors. */
  palette?: string;
  /** Images drawn into banks at build time, as pyxel.images[bank].load(x, y, file). */
  images?: { bank: number; x: number; y: number; file: string }[];
}

export function readManifest(directory: string): Manifest {
  const path = resolve(directory, "pyxel.json");
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const title = String(raw.title ?? basename(directory));
  const manifest: Manifest = {
    title,
    code: String(
      raw.code ??
        "P" +
          title
            .replace(/[^A-Za-z0-9]/g, "")
            .toUpperCase()
            .padEnd(3, "X")
            .slice(0, 3),
    ),
    entry: String(raw.entry ?? "game.ts"),
    ...(raw.resources ? { resources: String(raw.resources) } : {}),
    ...(raw.palette ? { palette: String(raw.palette) } : {}),
    ...(Array.isArray(raw.images)
      ? {
          images: raw.images.map((image: { bank?: number; x?: number; y?: number; file: string }) => ({
            bank: image.bank ?? 0,
            x: image.x ?? 0,
            y: image.y ?? 0,
            file: String(image.file),
          })),
        }
      : {}),
  };
  if (!existsSync(resolve(directory, manifest.entry)))
    throw new Error(`${directory}: entry ${manifest.entry} not found`);
  for (const file of [manifest.resources, manifest.palette, ...(manifest.images ?? []).map((image) => image.file)]) {
    if (file && !existsSync(resolve(directory, file))) throw new Error(`${directory}: ${file} not found`);
  }
  return manifest;
}
