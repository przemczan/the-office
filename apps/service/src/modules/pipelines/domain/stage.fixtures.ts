import type { AgentStage, Gate, ScriptStage } from "./stage.js";

/** The Developer's `implement` Stage, unless `fields` say otherwise. */
export function agentStage(fields: Partial<AgentStage> = {}): AgentStage {
  return {
    kind: "agent",
    key: "implement",
    name: "Implement",
    role: "developer",
    brief: "Implement the Plan.",
    session: "fresh",
    budget: 100_000,
    optional: false,
    ...fields,
  };
}

/** The `tests` Stage running the Project's test command, unless `fields` say otherwise. */
export function scriptStage(fields: Partial<ScriptStage> = {}): ScriptStage {
  return {
    kind: "script",
    key: "tests",
    name: "Tests",
    command: "test",
    optional: false,
    ...fields,
  };
}

export function gate(fields: Partial<Gate> = {}): Gate {
  return { kind: "gate", key: "gate", name: "Gate", optional: false, ...fields };
}
