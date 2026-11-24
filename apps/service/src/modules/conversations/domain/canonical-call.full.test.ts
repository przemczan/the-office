import { describe, expect, it } from "vitest";
import { canonicalCall } from "./canonical-call.js";

describe("canonicalCall", () => {
  it("reads the same whatever the order of the keys, at every depth", () => {
    expect(canonicalCall({ b: 1, a: { d: [{ y: 2, x: 1 }], c: "c" } })).toBe(
      canonicalCall({ a: { c: "c", d: [{ x: 1, y: 2 }] }, b: 1 }),
    );
  });

  it("trims each text and makes its runs of white space one space", () => {
    expect(canonicalCall({ line: "  npm   run\n\tbuild " })).toBe(
      canonicalCall({ line: "npm run build" }),
    );
  });

  it("keeps arrays in the order given and drops what was left out", () => {
    expect(canonicalCall({ keys: ["b", "a"], left: undefined })).toBe('{"keys":["b","a"]}');
    expect(canonicalCall({ keys: ["b", "a"] })).not.toBe(canonicalCall({ keys: ["a", "b"] }));
  });
});
