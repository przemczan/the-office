import { countedTokens } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { sumTokens, tokenKindLines } from "./token-words.ts";

const TOKENS = { input: 1_200, output: 3_400, cacheRead: 274_000, cacheCreation: 41_000 };

describe("countedTokens", () => {
  it("counts input, output and cache writes, leaving cache reads out", () => {
    expect(countedTokens(TOKENS)).toBe(45_600);
  });
});

describe("sumTokens", () => {
  it("adds each kind apart", () => {
    expect(sumTokens([TOKENS, { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 }])).toEqual({
      input: 1_201,
      output: 3_402,
      cacheRead: 274_003,
      cacheCreation: 41_004,
    });
    expect(sumTokens([])).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  });
});

describe("tokenKindLines", () => {
  it("gives each kind with what it costs, and says cache reads are left out", () => {
    expect(tokenKindLines(TOKENS)).toEqual([
      "Input 1.2k: read fresh, at the input price.",
      "Output 3.4k: written by the model, about 5× input.",
      "Cache writes 41k: kept for the next turns, about 1.25× input.",
      "Cache reads 274k: reused from the cache, about a tenth of input; left out of the count.",
    ]);
  });
});
