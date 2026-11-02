import { describe, expect, it } from "vitest";
import { modelLabel } from "./engine-words.ts";

describe("the engine's words", () => {
  it("names a model by its family and version, and any other id as it is", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabel("some-other-model")).toBe("some-other-model");
  });
});
