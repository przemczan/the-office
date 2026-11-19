import { describe, expect, it } from "vitest";
import { goldenCaseOutputs } from "./conversations-prompts.golden-cases.fixtures.js";
import { GOLDEN_OUTPUTS } from "./conversations-prompts.golden.js";

describe("Conversations' session instructions and Briefs, with every prompt template at its default", () => {
  const outputs = goldenCaseOutputs();

  it("render every case the golden file holds, and no other", () => {
    expect(Object.keys(outputs)).toEqual(Object.keys(GOLDEN_OUTPUTS));
  });

  it.each(Object.keys(GOLDEN_OUTPUTS))("render %s byte for byte as before", (name) => {
    expect(outputs[name]).toBe(GOLDEN_OUTPUTS[name]);
  });
});
