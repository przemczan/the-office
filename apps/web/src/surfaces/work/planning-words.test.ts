import { describe, expect, it } from "vitest";
import { statementsOf } from "./planning-words.ts";

describe("statementsOf", () => {
  it("takes one statement per line, trimmed, leaving out blank lines", () => {
    const text = ["  Sign-in returns to the page it left. ", "", "The tests pass.", "   "].join(
      "\n",
    );

    expect(statementsOf(text)).toEqual(["Sign-in returns to the page it left.", "The tests pass."]);
  });
});
