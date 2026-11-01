import { describe, expect, it } from "vitest";
import { NO_PRICE_TEXT, priceFieldProblem, priceOf } from "./model-price-fields.ts";

const TYPED = { input: "3", output: "15", cacheWrites: "3.75", cacheReads: "0.3" };

describe("a Model price's fields", () => {
  it("give the price typed, $0 being a price", () => {
    expect(priceOf(TYPED)).toEqual({ input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 });
    expect(priceOf({ input: "0", output: "0", cacheWrites: "0", cacheReads: "0" })).toEqual({
      input: 0,
      output: 0,
      cacheWrites: 0,
      cacheReads: 0,
    });
  });

  it("give no price while every field is empty", () => {
    expect(priceOf(NO_PRICE_TEXT)).toBeNull();
    expect(priceOf({ ...NO_PRICE_TEXT, input: "  " })).toBeNull();
  });

  it("ask for all four once one is filled", () => {
    const partly = { ...NO_PRICE_TEXT, input: "3" };

    expect(priceFieldProblem(partly, "output")).toBe("Give all four, or none for no price.");
    expect(priceFieldProblem(partly, "input")).toBeUndefined();
    expect(priceOf(partly)).toBeUndefined();
  });

  it("ask for a number", () => {
    expect(priceFieldProblem({ ...TYPED, output: "fifteen" }, "output")).toBe(
      "Give dollars as a number, such as 3 or 0.3.",
    );
    expect(priceOf({ ...TYPED, output: "fifteen" })).toBeUndefined();
  });
});
