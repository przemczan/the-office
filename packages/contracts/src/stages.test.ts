import { describe, expect, it } from "vitest";
import { scriptStageCommandSchema, stageSchema } from "./stages.js";

describe("a Script Stage's command", () => {
  it.each(["publish", "test", "test-full", "e2e2"])("takes %s", (command) => {
    expect(scriptStageCommandSchema.safeParse(command).success).toBe(true);
  });

  it.each(["install", "Test", "1x", "", "a".repeat(41)])("refuses %j", (command) => {
    expect(scriptStageCommandSchema.safeParse(command).success).toBe(false);
  });

  it("reads a Script Stage stored with a starting command as before", () => {
    const stage = { kind: "script", key: "test", name: "Test", optional: false, command: "test" };

    expect(stageSchema.parse(stage)).toEqual(stage);
  });
});

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
