/** ELF32 → GBA cartridge image, with the header the BIOS checks at boot. */

// Boot logo bitmap from the cartridge header format; the BIOS compares it.
const LOGO =
  "24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807";

export interface RomHeader {
  /** Up to 12 characters of uppercase ASCII. */
  title: string;
  /** Four characters of uppercase ASCII. */
  code: string;
}

function ascii(text: string, length: number): Uint8Array {
  const clean = text
    .toUpperCase()
    .replace(/[^A-Z0-9 ._-]/g, "")
    .slice(0, length);
  const out = new Uint8Array(length);
  out.set(new TextEncoder().encode(clean));
  return out;
}

/** Copies ELF load segments to their ROM addresses and writes the header. */
export function elfToRom(elf: Uint8Array, header: RomHeader): Uint8Array {
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  if (view.getUint32(0, false) !== 0x7f454c46 || elf[4] !== 1 || elf[5] !== 1 || view.getUint16(18, true) !== 40) {
    throw new Error("expected an ARM little-endian ELF32 file");
  }
  const phoff = view.getUint32(28, true),
    phentsize = view.getUint16(42, true),
    phnum = view.getUint16(44, true);
  const segments: { offset: number; address: number; size: number }[] = [];
  let end = 0xc0;
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phentsize;
    if (view.getUint32(p, true) !== 1) continue;
    const offset = view.getUint32(p + 4, true),
      physical = view.getUint32(p + 12, true),
      size = view.getUint32(p + 16, true);
    if (!size) continue;
    if (physical < 0x08000000 || physical + size > 0x0a000000) throw new Error("ELF load segment lies outside ROM");
    segments.push({ offset, address: physical - 0x08000000, size });
    end = Math.max(end, physical - 0x08000000 + size);
  }
  if (!segments.some((segment) => segment.address === 0 && segment.size >= 0xc0)) {
    throw new Error("ELF has no cartridge header segment at 0x08000000");
  }
  const rom = new Uint8Array((end + 3) & ~3).fill(0xff);
  for (const segment of segments) rom.set(elf.subarray(segment.offset, segment.offset + segment.size), segment.address);
  rom.set(Buffer.from(LOGO, "hex"), 0x04);
  rom.fill(0, 0xa0, 0xc0);
  rom.set(ascii(header.title, 12), 0xa0);
  rom.set(ascii(header.code, 4), 0xac);
  rom.set(new TextEncoder().encode("01"), 0xb0);
  rom[0xb2] = 0x96;
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += rom[i]!;
  rom[0xbd] = -(sum + 0x19) & 0xff;
  return rom;
}
