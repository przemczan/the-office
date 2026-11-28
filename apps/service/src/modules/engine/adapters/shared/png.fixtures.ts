import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

/** An RGB PNG of one colour, such as [255, 0, 0] for red. */
export function aPlainPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Uint8Array {
  const pixels = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) pixels.set(rgb, offset);
  return png(width, height, pixels);
}

/** An RGB PNG of random pixels, which deflate can't shrink: its size is about width × height × 3. */
export function aNoisyPng(width: number, height: number): Uint8Array {
  return png(width, height, randomBytes(width * height * 3));
}

function png(width: number, height: number, pixels: Buffer): Uint8Array {
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let row = 0; row < height; row += 1) {
    // Each row starts with its filter type, 0 for none.
    pixels.copy(rows, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}
