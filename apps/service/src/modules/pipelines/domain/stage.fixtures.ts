import type { DutyKey } from "../../people/index.js";
import type { KeptStage } from "./routes-back.js";
import type { AgentStage, Gate, ScriptStage, Stage } from "./stage.js";

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

/** The `implement` Agent Stage naming `duty` rather than a Role, unless `fields` say otherwise. */
export function dutyStage(duty: DutyKey, fields: Partial<AgentStage> = {}): AgentStage {
  const { role: _role, ...stage } = agentStage(fields);
  return { ...stage, duty, ...fields };
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

/**
 * `stage` with the on-failure setting a previous release kept on it, going back to `goBackTo` at
 * most `rounds` times, which `asFlow` reads as its failure route back: a plain list's way back.
 */
export function goingBackOnFailure<Of extends Stage>(
  stage: Of,
  goBackTo: string,
  rounds: number,
): KeptStage<Of> {
  return { ...stage, onFailure: { goBackTo, rounds } };
}
