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

describe("who works an Agent Stage", () => {
  const stage = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    optional: false,
    brief: "Build it.",
    session: "fresh",
    budget: 1000,
  };

  it("names a duty instead of a Role", () => {
    expect(stageSchema.parse({ ...stage, duty: "implements" })).toEqual({
      ...stage,
      duty: "implements",
    });
  });

  it("refuses a duty there isn't", () => {
    expect(stageSchema.safeParse({ ...stage, duty: "makes-coffee" }).success).toBe(false);
  });

  it("is left to the service's rules when it names neither or both", () => {
    expect(stageSchema.safeParse(stage).success).toBe(true);
    expect(stageSchema.safeParse({ ...stage, role: "developer", duty: "implements" }).success).toBe(
      true,
    );
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

describe("an Agent Stage's Project commands", () => {
  const implement = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    optional: false,
    role: "developer",
    brief: "Build it.",
    session: "fresh",
    budget: 1000,
  };

  function issuesOf(commands: unknown): string[] {
    const result = stageSchema.safeParse({ ...implement, permissions: { commands } });
    return result.success ? [] : result.error.issues.map(({ message }) => message);
  }

  it("is absent on a Stage stored before, which keeps every Project command", () => {
    expect(stageSchema.parse(implement)).not.toHaveProperty("permissions");
    expect(stageSchema.parse({ ...implement, permissions: { run: "anything" } })).toEqual({
      ...implement,
      permissions: { run: "anything" },
    });
  });

  it("keeps a list of keys in its order", () => {
    expect(
      stageSchema.parse({ ...implement, permissions: { commands: ["test", "lint"] } }),
    ).toMatchObject({ permissions: { commands: ["test", "lint"] } });
  });

  it("refuses an empty list, naming the Role card's instead", () => {
    expect(issuesOf([])).toEqual(["List at least one Project command, or leave the Role card's."]);
  });

  it("refuses a key listed twice", () => {
    expect(issuesOf(["test", "test"])).toEqual(["A Project command is listed twice."]);
  });

  it.each(["Test", "1x", "", "test full"])("refuses the invalid key %j", (key) => {
    expect(issuesOf([key])).toEqual([
      `A command's key is lower-case letters, digits and "-", starting with a letter.`,
    ]);
  });

  it.each(["install", "publish"])("refuses %s, kept for The Office's own use", (key) => {
    expect(issuesOf([key])).toEqual([`The key "${key}" is kept for The Office's own use.`]);
  });
});
