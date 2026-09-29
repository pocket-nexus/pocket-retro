/** Minimal PNG encode and decode for RGBA8888 and 8-bit indexed images. */
import { deflateSync, inflateSync } from "node:zlib";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes RGBA8888 pixels, optionally scaled by an integer factor. */
export function encodePng(rgba: Uint8Array, width: number, height: number, scale = 1): Uint8Array {
  const w = width * scale,
    h = height * scale;
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    for (let x = 0; x < w; x++) {
      const source = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      raw.set(rgba.subarray(source, source + 4), row + 1 + x * 4);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  header.set([8, 6, 0, 0, 0], 8);
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const parts = [signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Decodes 8-bit RGB, RGBA, grayscale or palette PNGs without interlacing. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    width = 0,
    height = 0,
    depth = 0,
    color = 0;
  let palette = new Uint8Array(),
    alpha = new Uint8Array();
  const data: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset),
      type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = body[8]!;
      color = body[9]!;
      if (body[12] !== 0) throw new Error("interlaced PNGs are not supported");
    } else if (type === "PLTE") palette = body.slice();
    else if (type === "tRNS") alpha = body.slice();
    else if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`unsupported PNG color type ${color}`);
  if (color !== 3 && depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  const inflated = inflateSync(Buffer.concat(data));
  const bitsPerPixel = channels * depth,
    stride = Math.ceil((width * bitsPerPixel) / 8),
    step = Math.max(1, bitsPerPixel / 8);
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)]!;
    const line = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? pixels[y * stride + x - step]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const c = x >= step && y > 0 ? pixels[(y - 1) * stride + x - step]! : 0;
      let value = line[x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      if (color === 3) {
        const bit = x * depth,
          index = (pixels[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        rgba.set([palette[index * 3]!, palette[index * 3 + 1]!, palette[index * 3 + 2]!, alpha[index] ?? 255], out);
      } else {
        const p = y * stride + x * channels;
        const [r, g, b, a] =
          channels === 1
            ? [pixels[p]!, pixels[p]!, pixels[p]!, 255]
            : channels === 2
              ? [pixels[p]!, pixels[p]!, pixels[p]!, pixels[p + 1]!]
              : [pixels[p]!, pixels[p + 1]!, pixels[p + 2]!, channels === 4 ? pixels[p + 3]! : 255];
        rgba.set([r, g, b, a], out);
      }
    }
  return { width, height, rgba };
}
