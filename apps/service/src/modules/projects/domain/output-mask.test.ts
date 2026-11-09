import { describe, expect, it } from "vitest";
import { OutputMask } from "./output-mask.js";

const mask = new OutputMask([
  { name: "NPM_TOKEN", value: "npm_s3cret" },
  { name: "LONGER", value: "npm_s3cret_and_more" },
  { name: "PATTERN", value: "a.b*c(d)" },
]);

function streamed(chunks: readonly string[], through: OutputMask = mask): string {
  const masked = through.chunks();
  const parts = chunks.map((chunk) => Buffer.from(masked.next(Buffer.from(chunk, "utf8"))));
  parts.push(Buffer.from(masked.end()));
  return Buffer.concat(parts).toString("utf8");
}

describe("OutputMask.mask", () => {
  it("shows each value as its name", () => {
    expect(mask.mask("token npm_s3cret, again npm_s3cret.")).toBe(
      "token [secret NPM_TOKEN], again [secret NPM_TOKEN].",
    );
  });

  it("hides the longer of two values that start alike, and reads a value as plain text", () => {
    expect(mask.mask("npm_s3cret_and_more a.b*c(d) axb*c(d)")).toBe(
      "[secret LONGER] [secret PATTERN] axb*c(d)",
    );
  });

  it("changes nothing without Secret variables", () => {
    expect(OutputMask.NONE.mask("npm_s3cret")).toBe("npm_s3cret");
    expect(
      OutputMask.of({
        set: [
          { name: "PLAIN", value: "visible", secret: false },
          { name: "NPM_TOKEN", value: "npm_s3cret", secret: true },
        ],
        unset: [],
        prependPath: [],
      }).mask("visible npm_s3cret"),
    ).toBe("visible [secret NPM_TOKEN]");
  });
});

describe("OutputMask.chunks", () => {
  it("hides a value cut across chunks", () => {
    expect(streamed(["printing npm_s3", "cret now\n"])).toBe("printing [secret NPM_TOKEN] now\n");
    expect(streamed(["n", "p", "m", "_", "s", "3", "c", "r", "e", "t"])).toBe("[secret NPM_TOKEN]");
  });

  it("holds back only what may start a value, and gives the rest at the end", () => {
    const masked = mask.chunks();
    const first = Buffer.from(
      masked.next(Buffer.from("plain text, long enough to give, then npm_s3c")),
    ).toString();
    expect(first.startsWith("plain text, long enough")).toBe(true);
    expect(first).not.toContain("npm_s3c");
    expect(Buffer.from(masked.end()).toString()).toContain("npm_s3c");
  });

  it("hides the longer value when its end comes in a later chunk", () => {
    expect(streamed(["npm_s3cret_and", "_more"])).toBe("[secret LONGER]");
  });

  it("keeps a character cut across chunks whole, and a value that isn't ASCII", () => {
    const unicode = new OutputMask([{ name: "ZAŻÓŁĆ", value: "gęślą-jaźń" }]);
    const bytes = Buffer.from("é gęślą-jaźń é", "utf8");
    const masked = unicode.chunks();
    const out = Buffer.concat([
      Buffer.from(masked.next(bytes.subarray(0, 1))),
      Buffer.from(masked.next(bytes.subarray(1, 9))),
      Buffer.from(masked.next(bytes.subarray(9))),
      Buffer.from(masked.end()),
    ]).toString("utf8");
    expect(out).toBe("é [secret ZAŻÓŁĆ] é");
  });

  it("passes chunks through untouched without Secret variables", () => {
    expect(streamed(["npm_s3", "cret"], OutputMask.NONE)).toBe("npm_s3cret");
  });
});
