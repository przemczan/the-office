import type { Stage } from "@the-office/contracts";
import { withPermissions } from "./stage-permissions.ts";

/**
 * The Stage editor's changes to a list of Stages, each answering the new list. Stages before
 * `lockedStages` have started: no change moves, drops or puts a Stage among them. What makes a list
 * unusable is the service's to say (`stagesCheck`), so these only keep it well formed.
 */

export type StageKind = Stage["kind"];
export type AgentStage = Extract<Stage, { kind: "agent" }>;
export type ScriptStage = Extract<Stage, { kind: "script" }>;
export type StageCommand = ScriptStage["command"];

export const STAGE_KIND_NAMES: Readonly<Record<StageKind, string>> = {
  agent: "Agent Stage",
  script: "Script Stage",
  gate: "Gate",
};

export const STAGE_COMMANDS: readonly StageCommand[] = ["test", "lint", "build", "publish"];

/** Tokens an added Agent Stage may spend, as the click-through's default. */
const NEW_AGENT_STAGE_BUDGET = 100_000;

const NEW_STAGE_NAMES: Readonly<Record<StageKind, string>> = {
  agent: "New Stage",
  script: "Script",
  gate: "Gate",
};

/**
 * A new Stage of `kind` added where it usually goes, with a key and name no other Stage has: a Gate
 * before the last Stage, which usually publishes; anything else at the end.
 */
export function addStage(
  stages: readonly Stage[],
  kind: StageKind,
  lockedStages: number,
): { readonly stages: readonly Stage[]; readonly index: number } {
  const index = kind === "gate" && stages.length > lockedStages ? stages.length - 1 : stages.length;
  const name = unique(
    NEW_STAGE_NAMES[kind],
    stages.map((stage) => stage.name),
    " ",
  );
  const key = unique(
    slugOf(name),
    stages.map((stage) => stage.key),
    "-",
  );
  return { stages: stages.toSpliced(index, 0, newStage(kind, key, name)), index };
}

/** The Stage dropped, and every failure rule that went back to it with it. */
export function removeStage(stages: readonly Stage[], index: number): readonly Stage[] {
  const gone = stages[index];
  if (!gone) return stages;
  return stages
    .filter((_stage, at) => at !== index)
    .map((stage) =>
      stage.kind !== "gate" && stage.onFailure?.goBackTo === gone.key
        ? { ...stage, onFailure: undefined }
        : stage,
    );
}

export function canMove(
  stages: readonly Stage[],
  index: number,
  by: -1 | 1,
  lockedStages: number,
): boolean {
  const to = index + by;
  return index >= lockedStages && to >= lockedStages && to < stages.length;
}

export function moveStage(
  stages: readonly Stage[],
  index: number,
  by: -1 | 1,
  lockedStages: number,
): readonly Stage[] {
  const stage = stages[index];
  if (!stage || !canMove(stages, index, by, lockedStages)) return stages;
  return stages.toSpliced(index, 1).toSpliced(index + by, 0, stage);
}

export function replaceStage(
  stages: readonly Stage[],
  index: number,
  stage: Stage,
): readonly Stage[] {
  return stages.with(index, stage);
}

/**
 * The Agent Stage given to another Role. It can only continue the session before with the same
 * Role there, so otherwise it starts fresh.
 */
export function withRole(stages: readonly Stage[], index: number, role: string): AgentStage {
  const stage = stages[index];
  if (stage?.kind !== "agent") throw new Error(`Stage ${index + 1} isn't an Agent Stage.`);
  // The MCP tools set belong to the Role's servers, so another Role starts from its own card.
  const changed = withPermissions({ ...stage, role }, { mcpTools: undefined });
  return changed.session === "continue" && !canContinue(stages.with(index, changed), index)
    ? { ...changed, session: "fresh" }
    : changed;
}

/** The Script Stage running another command; only a Publish Stage keeps what Publish alone says. */
export function withCommand(stage: ScriptStage, command: StageCommand): ScriptStage {
  if (command === "publish") return { ...stage, command };
  const { publishTarget: _publishTarget, afterConflict: _afterConflict, ...rest } = stage;
  return { ...rest, command };
}

/** Whether the Agent Stage may continue the session of the Stage before: the same Role works it. */
export function canContinue(stages: readonly Stage[], index: number): boolean {
  const stage = stages[index];
  const previous = stages[index - 1];
  return stage?.kind === "agent" && previous?.kind === "agent" && previous.role === stage.role;
}

/** The Stages a failure may go back to: earlier ones that work, not Gates. */
export function failureTargets(stages: readonly Stage[], index: number): readonly Stage[] {
  return stages.slice(0, index).filter((stage) => stage.kind !== "gate");
}

function newStage(kind: StageKind, key: string, name: string): Stage {
  switch (kind) {
    case "agent":
      return {
        kind,
        key,
        name,
        optional: false,
        role: "",
        brief: "",
        session: "fresh",
        budget: NEW_AGENT_STAGE_BUDGET,
      };
    case "script":
      return { kind, key, name, optional: false, command: "test" };
    case "gate":
      return { kind, key, name, optional: false };
  }
}

function unique(base: string, taken: readonly string[], separator: string): string {
  let candidate = base;
  for (let number = 2; taken.includes(candidate); number += 1) {
    candidate = `${base}${separator}${number}`;
  }
  return candidate;
}

function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}
