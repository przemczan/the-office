import { crc32, deflateSync } from "node:zlib";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** The raw scanlines of a solid image: each row a filter byte of 0 (none) then its RGB pixels. */
export function solidScanlines(width: number, height: number, colour: Rgb): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row.set([colour.red, colour.green, colour.blue], 1 + x * 3);
  }
  return Buffer.concat(Array.from({ length: height }, () => row));
}

/** A PNG of one colour, 8-bit RGB: what `copilot.images` asks the model to name. */
export function solidPng(width: number, height: number, colour: Rgb): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Bit depth 8, colour type 2 (RGB), deflate, adaptive filtering, no interlace.
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(solidScanlines(width, height, colour))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}
