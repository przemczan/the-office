import { isDeepStrictEqual } from "node:util";
import type { StagePermissions } from "./stage-permissions.js";

/** One step of a Pipeline (spec §2.3): work by an Agent in a Role, a Project command, or a Gate. */
export type Stage = AgentStage | ScriptStage | Gate;

export type StageKind = Stage["kind"];

/** Each kind as the UI names it. */
export const STAGE_KIND_NAMES: Readonly<Record<StageKind, string>> = {
  agent: "Agent Stage",
  script: "Script Stage",
  gate: "Gate",
};

/**
 * The Project command a Script Stage runs. `publish` is the Project's publishing mode, run by The
 * Office's own git code rather than a command string (spec §9).
 */
export type ScriptStageCommand = "build" | "lint" | "test" | "publish";

/**
 * Where a Publish Stage takes the Task's branch (spec §2.3's proof-of-concept publish target): by
 * the Project's publishing mode, or pushed as a branch only, with no pull request and no merge.
 */
export type PublishTarget = "publishing-mode" | "branch-only";

/**
 * What a Publish Stage does once a conflict is resolved and tested (spec §2.3, "Conflicts at
 * Publish"): publish automatically, or wait at a Gate for the user's review first.
 */
export type AfterConflict = "publish" | "review";

/** Fresh with a Brief, or continuing the previous Stage's session when the same Role worked it. */
export type StageSession = "fresh" | "continue";

/** How hard the model thinks, as the engine names it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * "On failure go back to Stage X, at most N times": a Pipeline's only control flow. Its rounds are
 * the Stage's round limit; once they are used up, the Task goes to the user.
 */
export interface OnFailure {
  /** The key of an earlier Stage that isn't a Gate. */
  readonly goBackTo: string;
  readonly rounds: number;
}

interface StageFields {
  /** Names the Stage within its Pipeline and stays when the Stage is renamed. */
  readonly key: string;
  readonly name: string;
  /** Skipped when the Definition of Done is already met. */
  readonly optional: boolean;
}

export interface AgentStage extends StageFields {
  readonly kind: "agent";
  /** The key of the Role that works it. */
  readonly role: string;
  /** Plain words, filled with the Task's Plan, Definition of Done and earlier results. */
  readonly brief: string;
  readonly session: StageSession;
  /** Tokens the Stage may use; reaching them asks the user. */
  readonly budget: number;
  /** Absent keeps the Role's. */
  readonly effort?: Effort;
  /** Narrows the Role card's permission profile; absent keeps it whole. */
  readonly permissions?: StagePermissions;
  readonly onFailure?: OnFailure;
}

export interface ScriptStage extends StageFields {
  readonly kind: "script";
  readonly command: ScriptStageCommand;
  /** A Publish Stage's alone; absent means the Project's publishing mode. */
  readonly publishTarget?: PublishTarget;
  /** A Publish Stage's alone; absent publishes automatically. */
  readonly afterConflict?: AfterConflict;
  readonly onFailure?: OnFailure;
}

/** The Task waits for the user to look at the work so far and let it continue. */
export interface Gate extends StageFields {
  readonly kind: "gate";
}

/** The Roles the Agent Stages among `stages` name, each once. */
export function agentStageRoles(stages: readonly Stage[]): ReadonlySet<string> {
  return new Set(stages.flatMap((stage) => (stage.kind === "agent" ? [stage.role] : [])));
}

/** Those of `named` that `already` doesn't hold: the Roles a save of Stages newly names. */
export function newlyNamedRoles(
  named: ReadonlySet<string>,
  already: ReadonlySet<string>,
): readonly string[] {
  return [...named].filter((roleKey) => !already.has(roleKey));
}

/**
 * Stages alike as they are kept, where a field left out and one left undefined are the same: a
 * Proposal's Stages come back from storage without the fields left undefined.
 */
export function sameAsKept(
  one: Stage | readonly Stage[],
  other: Stage | readonly Stage[],
): boolean {
  return isDeepStrictEqual(asKept(one), asKept(other));
}

function asKept(stages: Stage | readonly Stage[]): unknown {
  return JSON.parse(JSON.stringify(stages));
}
