import { describe, expect, it } from "vitest";
import { filteredOutput } from "./command-run.js";

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
