import { describe, expect, it } from "vitest";
import { stageSchema } from "./stages.js";

describe("an Agent Stage", () => {
  it("has no model of its own: one sent or kept from before is dropped", () => {
    const stage = stageSchema.parse({
      kind: "agent",
      key: "implement",
      name: "Implement",
      optional: false,
      role: "developer",
      brief: "Build it.",
      session: "fresh",
      budget: 1000,
      model: "claude-haiku-5-5",
      effort: "low",
    });

    expect(stage).not.toHaveProperty("model");
    expect(stage).toMatchObject({ kind: "agent", effort: "low" });
  });
});
