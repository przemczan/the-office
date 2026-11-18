import type { DutyKey, Stage, StageTemplate } from "@the-office/contracts";
import { PUBLISH_COMMAND } from "./stage-commands.ts";
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

/** Each kind's icon, in the Stage editor and the Stage templates' list. */
export const STAGE_KIND_ICONS: Readonly<Record<StageKind, string>> = {
  agent: "user",
  script: "terminal",
  gate: "hand",
};

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
): AddedStage {
  return placed(stages, newStage(kind, "", NEW_STAGE_NAMES[kind]), lockedStages);
}

/**
 * A copy of the Stage template's Stage, added where a new Stage of its kind goes. A copy, never a
 * link: it gets its own key, keeps its name unless another Stage has it, and has no failure rule,
 * which only names a Stage of the list it goes into.
 */
export function addStageFrom(
  stages: readonly Stage[],
  template: StageTemplate,
  lockedStages: number,
): AddedStage {
  return placed(stages, withoutFailureRule(template.stage), lockedStages);
}

/** A Stage as a Stage template keeps it: no failure rule, which only a Pipeline gives meaning. */
export function withoutFailureRule(stage: Stage): Stage {
  if (stage.kind === "gate") return stage;
  const { onFailure: _onFailure, ...rest } = stage;
  return rest;
}

/** The Stages after an addition, and where the added one is. */
export interface AddedStage {
  readonly stages: readonly Stage[];
  readonly index: number;
}

function placed(stages: readonly Stage[], stage: Stage, lockedStages: number): AddedStage {
  const index =
    stage.kind === "gate" && stages.length > lockedStages ? stages.length - 1 : stages.length;
  return { stages: stages.toSpliced(index, 0, namedAmong(stage, stages)), index };
}

/** The Stage with a name and a key none of `stages` has, its own kept where they're free. */
export function namedAmong(stage: Stage, stages: readonly Stage[]): Stage {
  const name = unique(
    stage.name.trim() || NEW_STAGE_NAMES[stage.kind],
    stages.map((other) => other.name),
    " ",
  );
  const key = keyAmong({ ...stage, name }, stages);
  return { ...stage, key, name };
}

/** A key for the Stage, from its name, that none of `stages` has. */
export function keyAmong(stage: Stage, stages: readonly Stage[]): string {
  return unique(
    slugOf(stage.name) || slugOf(NEW_STAGE_NAMES[stage.kind]),
    stages.map(({ key }) => key),
    "-",
  );
}

/** A new Stage of `kind` on its own, as a Stage template made from scratch starts. */
export function standaloneStage(kind: StageKind): Stage {
  const name = NEW_STAGE_NAMES[kind];
  return newStage(kind, slugOf(name), name);
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

/** Who an Agent Stage names to work it: a Role, or a duty whose holder works it when it starts. */
export type StageWorker = { readonly role: string } | { readonly duty: DutyKey };

/**
 * Who `stage` names; undefined for a Stage of another kind or one naming nobody yet. A Stage naming
 * both, which the service refuses, reads as naming its Role, as the service reads it.
 */
export function stageWorker(stage: Stage): StageWorker | undefined {
  if (stage.kind !== "agent") return undefined;
  if (stage.role !== undefined && stage.role.trim() !== "") return { role: stage.role };
  if (stage.duty !== undefined) return { duty: stage.duty };
  return undefined;
}

/**
 * The Agent Stage given to another Role, its duty cleared. It can only continue the session before
 * with the same Role there, so otherwise it starts fresh.
 */
export function withRole(stages: readonly Stage[], index: number, role: string): AgentStage {
  const { duty: _duty, ...stage } = agentStageAt(stages, index);
  return withWorker(stages, index, { ...stage, role });
}

/** The Agent Stage given to a duty, its Role cleared; continuing then needs the same duty before. */
export function withDuty(stages: readonly Stage[], index: number, duty: DutyKey): AgentStage {
  const { role: _role, ...stage } = agentStageAt(stages, index);
  return withWorker(stages, index, { ...stage, duty });
}

function agentStageAt(stages: readonly Stage[], index: number): AgentStage {
  const stage = stages[index];
  if (stage?.kind !== "agent") throw new Error(`Stage ${index + 1} isn't an Agent Stage.`);
  return stage;
}

function withWorker(stages: readonly Stage[], index: number, stage: AgentStage): AgentStage {
  // The MCP tools set belong to the Role's servers, so whoever else works it starts from their card.
  const changed = withPermissions(stage, { mcpTools: undefined });
  return changed.session === "continue" && !canContinue(stages.with(index, changed), index)
    ? { ...changed, session: "fresh" }
    : changed;
}

/**
 * The Script Stage running another command, Publish or any Project command's key; only a Publish
 * Stage keeps what Publish alone says.
 */
export function withCommand(stage: ScriptStage, command: StageCommand): ScriptStage {
  if (command === PUBLISH_COMMAND) return { ...stage, command };
  const { publishTarget: _publishTarget, afterConflict: _afterConflict, ...rest } = stage;
  return { ...rest, command };
}

/**
 * Whether the Agent Stage may continue the session of the Stage before: both name the same Role,
 * or the same duty.
 */
export function canContinue(stages: readonly Stage[], index: number): boolean {
  const stage = stages[index];
  const previous = stages[index - 1];
  return (
    stage?.kind === "agent" &&
    previous?.kind === "agent" &&
    sameWorker(stageWorker(stage), stageWorker(previous))
  );
}

function sameWorker(one: StageWorker | undefined, other: StageWorker | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  if ("role" in one) return "role" in other && one.role === other.role;
  return "duty" in other && one.duty === other.duty;
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
