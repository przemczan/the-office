import { describe, expect, it } from "vitest";
import { toLineNow, toLinePicked } from "./to-line.ts";

describe("toLineNow", () => {
  it("starts on the newest Thread", () => {
    expect(toLineNow(undefined, "newest", false)).toEqual(toLinePicked("newest", "newest"));
  });

  it("holds a pick until a newer Thread starts", () => {
    const picked = toLinePicked("older", "newest");
    expect(toLineNow(picked, "newest", false)).toBe(picked);
    expect(toLineNow(picked, "newer", false)).toEqual(toLinePicked("newer", "newer"));
  });

  it("moves nothing under a draft", () => {
    const picked = toLinePicked("older", "newest");
    expect(toLineNow(picked, "newer", true)).toBe(picked);
  });
});
