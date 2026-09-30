/**
 * Animated GIF encoder for emulator captures. Pyxel games show at most 256
 * colors, so every frame shares one global palette. Frames that repeat the
 * previous one are merged into a longer delay, and each later frame stores
 * only the rectangle that changed, with unchanged pixels transparent.
 * Pixels with alpha below 128 are transparent; as later frames only draw
 * over earlier ones, a pixel that is transparent must stay so.
 */

export interface GifFrame {
  /** RGBA8888 pixels of the full image. */
  rgba: Uint8Array;
  /** How long the frame shows, in seconds. */
  duration: number;
}

/** Encodes frames of `width` x `height` pixels, scaled up by an integer factor, looping forever. */
export function encodeGif(frames: GifFrame[], width: number, height: number, scale = 1): Uint8Array {
  if (frames.length === 0) throw new Error("a GIF needs at least one frame");
  // One palette for all frames, plus an index for unchanged pixels.
  const colors = new Map<number, number>();
  const indexed = frames.map(({ rgba }) => {
    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) {
      const rgb = rgba[i * 4 + 3]! < 128 ? -1 : (rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!;
      let index = colors.get(rgb);
      if (index === undefined) {
        index = colors.size;
        if (index === 255) throw new Error("a GIF capture holds at most 255 colors");
        colors.set(rgb, index);
      }
      pixels[i] = index;
    }
    return pixels;
  });
  // Transparent pixels share the index of unchanged ones, past the colors.
  const transparent = colors.has(-1) ? colors.get(-1)! : colors.size;
  let bits = 1;
  while (1 << bits < colors.size + 1) bits++;

  const out: number[] = [];
  const u16 = (value: number) => out.push(value & 0xff, value >> 8);
  const ascii = (text: string) => out.push(...new TextEncoder().encode(text));
  ascii("GIF89a");
  u16(width * scale);
  u16(height * scale);
  out.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  const table = new Uint8Array(3 << bits);
  for (const [rgb, index] of colors) if (rgb >= 0) table.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff], index * 3);
  out.push(...table);
  // NETSCAPE2.0 application extension: loop forever.
  out.push(0x21, 0xff, 11);
  ascii("NETSCAPE2.0");
  out.push(3, 1, 0, 0, 0);

  // Delays are whole centiseconds; round the running time so they do not drift.
  let time = 0;
  let shown = 0;
  let previous: Uint8Array | undefined;
  for (let f = 0; f < indexed.length; f++) {
    const pixels = indexed[f]!;
    time += frames[f]!.duration;
    if (f + 1 < indexed.length && equal(pixels, indexed[f + 1]!)) continue;
    const delay = Math.round(time * 100) - shown;
    shown += delay;
    let [left, top, right, bottom] = [0, 0, width, height];
    if (previous) [left, top, right, bottom] = changedRect(previous, pixels, width, height);
    // Graphic control extension: keep the previous frame under this one.
    out.push(0x21, 0xf9, 4, (1 << 2) | 1, delay & 0xff, delay >> 8, transparent, 0);
    const w = right - left,
      h = bottom - top;
    out.push(0x2c);
    u16(left * scale);
    u16(top * scale);
    u16(w * scale);
    u16(h * scale);
    out.push(0);
    const region = new Uint8Array(w * scale * h * scale);
    for (let y = 0; y < h * scale; y++)
      for (let x = 0; x < w * scale; x++) {
        const i = (top + Math.floor(y / scale)) * width + left + Math.floor(x / scale);
        region[y * w * scale + x] = previous && previous[i] === pixels[i] ? transparent : pixels[i]!;
      }
    const minimum = Math.max(2, bits);
    out.push(minimum);
    const data = lzw(region, minimum);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
    previous = pixels;
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Bounding box [left, top, right, bottom) of the pixels that differ; one pixel when none do. */
function changedRect(a: Uint8Array, b: Uint8Array, width: number, height: number): number[] {
  let [left, top, right, bottom] = [width, height, 0, 0];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (a[y * width + x] !== b[y * width + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
      }
  return right === 0 ? [0, 0, 1, 1] : [left, top, right, bottom];
}

/** GIF's variable-width LZW, with a clear code whenever the 12-bit table fills. */
function lzw(pixels: Uint8Array, minimum: number): Uint8Array {
  const clear = 1 << minimum,
    end = clear + 1;
  const out: number[] = [];
  let buffer = 0,
    count = 0,
    size = minimum + 1,
    next = end + 1;
  const emit = (code: number) => {
    buffer |= code << count;
    count += size;
    while (count >= 8) {
      out.push(buffer & 0xff);
      buffer >>>= 8;
      count -= 8;
    }
  };
  const codes = new Map<number, number>();
  emit(clear);
  let prefix = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const key = (prefix << 8) | pixels[i]!;
    const code = codes.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      codes.clear();
      size = minimum + 1;
      next = end + 1;
    } else {
      if (next >= 1 << size) size++;
      codes.set(key, next++);
    }
    prefix = pixels[i]!;
  }
  emit(prefix);
  emit(end);
  if (count > 0) out.push(buffer & 0xff);
  return Uint8Array.from(out);
}
