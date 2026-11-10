import { describe, expect, it } from "vitest";
import { filteredOutput, wholeOutputOf } from "./command-run.js";

const numbered = (count: number, from = 1): string[] =>
  Array.from({ length: count }, (_, index) => `line ${from + index}`);

describe("filteredOutput", () => {
  it("keeps a short output whole, without colours", () => {
    expect(filteredOutput("\u001b[32m✓ 12 passed\u001b[39m\r\nDone in 3 s\n")).toBe(
      "✓ 12 passed\nDone in 3 s",
    );
  });

  it("keeps each failure with three lines around it, and the last 30 lines", () => {
    const output = [
      ...numbered(10),
      "FAIL src/index.test.ts",
      ...numbered(50, 11),
      "Tests: 1 failed, 40 passed",
    ].join("\n");

    expect(filteredOutput(output).split("\n")).toEqual([
      "… 7 lines left out",
      "line 8",
      "line 9",
      "line 10",
      "FAIL src/index.test.ts",
      "line 11",
      "line 12",
      "line 13",
      "… 18 lines left out",
      ...numbered(29, 32),
      "Tests: 1 failed, 40 passed",
    ]);
  });

  it("keeps the end of an output still too long", () => {
    const filtered = filteredOutput(
      numbered(25)
        .map((line) => `error: ${line.repeat(40)}`)
        .join("\n"),
    );

    expect(filtered.length).toBeLessThanOrEqual(6000 + "… the start left out\n".length);
    expect(filtered).toMatch(/^… the start left out\n/);
    expect(filtered).toMatch(/line 25$/);
  });
});

describe("wholeOutputOf", () => {
  const LIMIT = 64 * 1024;

  it("keeps an output within the limit whole, with no line about a cut", () => {
    const output = "x".repeat(LIMIT);

    expect(wholeOutputOf(output, 0)).toBe(output);
  });

  it("keeps what filtering would leave out", () => {
    expect(wholeOutputOf(numbered(100).join("\n"), 0)).toBe(numbered(100).join("\n"));
  });

  it("keeps the last 64 KB under a line saying how much was cut", () => {
    const [cutLine, kept] = wholeOutputOf(`aa${"b".repeat(LIMIT)}`, 0).split("\n");

    expect(cutLine).toBe("… 2 bytes cut from the start");
    expect(kept).toBe("b".repeat(LIMIT));
  });

  it("counts what the runner dropped before it as cut too", () => {
    const output = wholeOutputOf("a".repeat(LIMIT), 3 * 1024 * 1024);

    expect(output.split("\n")[0]).toBe("… 3.0 MB cut from the start");
  });

  it("never starts in the middle of a character", () => {
    const [cutLine, kept] = wholeOutputOf(`€${"b".repeat(LIMIT - 1)}`, 0).split("\n");

    expect(cutLine).toBe("… 3 bytes cut from the start");
    expect(kept).toBe("b".repeat(LIMIT - 1));
  });

  it("leaves out colours and NUL characters, which aren't counted as cut", () => {
    expect(wholeOutputOf("\u001b[31mred\u001b[39m\0\r\nDone\n", 0)).toBe("red\nDone");
  });
});
