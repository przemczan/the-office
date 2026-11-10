import { describe, expect, it } from "vitest";
import { IMAGE_SIZE_LIMIT, mediaTypeOf, readImage } from "./image-rules.js";

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0);

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("mediaTypeOf", () => {
  it("reads PNG, JPEG and WebP from their signatures", () => {
    expect(mediaTypeOf(PNG)).toBe("image/png");
    expect(mediaTypeOf(JPEG)).toBe("image/jpeg");
    expect(mediaTypeOf(bytesOf("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });

  it.each([
    ["alone", "<svg xmlns='http://www.w3.org/2000/svg'/>"],
    ["with nothing after its name", "<svg>"],
    ["after an XML declaration", '<?xml version="1.0" encoding="UTF-8"?>\n<svg/>'],
    ["after a comment", "<!-- drawn by hand --><svg></svg>"],
    ["after a declaration and comments", '<?xml version="1.0"?>\n<!-- a -->\n<!-- b -->\n<svg/>'],
    ["after a doctype", '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd">\n<svg/>'],
    ["after a doctype with entities", '<!DOCTYPE svg [<!ENTITY a "<b>">]>\n<svg/>'],
    ["after a byte order mark and spaces", "﻿  \n<svg/>"],
  ])("reads an SVG %s", (_, text) => {
    expect(mediaTypeOf(bytesOf(text))).toBe("image/svg+xml");
  });

  it.each([
    ["HTML holding an SVG", "<html><body><svg></svg></body></html>"],
    ["another element whose name starts the same", "<svgfoo/>"],
    ["an SVG only inside a comment", "<!-- <svg/> --><html/>"],
    ["a comment that never ends", "<!-- <svg/>"],
    ["a doctype that never ends", "<!DOCTYPE svg [ <svg/>"],
    ["plain text", "just some words"],
    ["a RIFF file that isn't WebP", "RIFF\0\0\0\0WAVEfmt "],
    ["a signature cut short", "\x89PNG"],
  ])("reads nothing from %s", (_, text) => {
    expect(mediaTypeOf(bytesOf(text))).toBeUndefined();
  });
});

describe("readImage", () => {
  it("takes its media type from the bytes", () => {
    expect(readImage(PNG)).toEqual({ mediaType: "image/png" });
  });

  it("takes an image of exactly the limit", () => {
    const content = new Uint8Array(IMAGE_SIZE_LIMIT);
    content.set(PNG);

    expect(readImage(content)).toEqual({ mediaType: "image/png" });
  });

  it("refuses an empty file", () => {
    expect(readImage(new Uint8Array())).toEqual({ problem: "The file is empty." });
  });

  it("refuses a file over the limit", () => {
    const content = new Uint8Array(IMAGE_SIZE_LIMIT + 1);
    content.set(PNG);

    expect(readImage(content)).toEqual({ problem: "An image may be at most 2 MB." });
  });

  it("refuses anything else", () => {
    expect(readImage(bytesOf("MZ, a program with a .png name"))).toEqual({
      problem: "The file isn't a PNG, JPEG, WebP or SVG image.",
    });
  });
});
