/** Reads the entries of a zip archive (stored or deflated). */
import { inflateRawSync } from "node:zlib";

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip archive");
  const count = view.getUint16(end + 10, true);
  let entry = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(entry, true) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = view.getUint16(entry + 10, true);
    const compressed = view.getUint32(entry + 20, true);
    const nameLength = view.getUint16(entry + 28, true);
    const extraLength = view.getUint16(entry + 30, true);
    const commentLength = view.getUint16(entry + 32, true);
    const local = view.getUint32(entry + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(entry + 46, entry + 46 + nameLength));
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(data, data + compressed);
    if (method === 0) files.set(name, raw.slice());
    else if (method === 8) files.set(name, new Uint8Array(inflateRawSync(raw)));
    else throw new Error(`zip entry ${name} uses unsupported method ${method}`);
    entry += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
