import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, inflateSync } from "node:zlib";
import { PNG_SIGNATURE, solidPng, solidScanlines } from "./solid-png.ts";

const RED = { red: 255, green: 0, blue: 0 };

/** Each chunk of a PNG after its signature, by type, with whether its checksum holds. */
function chunks(png: Buffer): { type: string; data: Buffer; checksumHolds: boolean }[] {
  const found = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const typeAndData = png.subarray(offset + 4, offset + 8 + length);
    found.push({
      type: typeAndData.subarray(0, 4).toString("latin1"),
      data: typeAndData.subarray(4),
      checksumHolds: png.readUInt32BE(offset + 8 + length) === crc32(typeAndData),
    });
    offset += 12 + length;
  }
  return found;
}

test("starts with the PNG signature and holds IHDR, IDAT and IEND with valid checksums", () => {
  const png = solidPng(64, 64, RED);
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
  const found = chunks(png);
  assert.deepEqual(
    found.map((each) => each.type),
    ["IHDR", "IDAT", "IEND"],
  );
  assert.ok(found.every((each) => each.checksumHolds));
});

test("IHDR gives the size, 8-bit RGB", () => {
  const header = chunks(solidPng(64, 32, RED))[0]!.data;
  assert.equal(header.readUInt32BE(0), 64);
  assert.equal(header.readUInt32BE(4), 32);
  assert.deepEqual([...header.subarray(8)], [8, 2, 0, 0, 0]);
});

test("IDAT inflates to each row's filter byte and its pixels in the colour", () => {
  const data = inflateSync(chunks(solidPng(2, 2, RED))[1]!.data);
  assert.deepEqual([...data], [0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  assert.deepEqual(data, solidScanlines(2, 2, RED));
});
