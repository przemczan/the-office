import { describe, expect, it } from "vitest";
import { goldenCaseOutputs } from "./work-prompts.golden-cases.fixtures.js";
import { GOLDEN_OUTPUTS } from "./work-prompts.golden.js";

describe("Work's instructions, openings and Briefs, with every prompt template at its default", () => {
  const outputs = goldenCaseOutputs();

  it("render every case the golden file holds, and no other", () => {
    expect(Object.keys(outputs)).toEqual(Object.keys(GOLDEN_OUTPUTS));
  });

  it.each(Object.keys(GOLDEN_OUTPUTS))("render %s byte for byte as before", (name) => {
    expect(outputs[name]).toBe(GOLDEN_OUTPUTS[name]);
  });
});
