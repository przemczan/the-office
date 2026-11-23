import { isDeepStrictEqual } from "node:util";
import type { DutyKey } from "../../people/index.js";
import { commandKeysOfRoutes, type Route, type StagePlace } from "./route.js";
import type { StageContextLimitsOverride } from "./stage-context-limits.js";
import type { StagePermissions } from "./stage-permissions.js";

/**
 * One step of a Pipeline (spec §2.3.1): work by an Agent in a Role, a Project command, a Gate, or
 * The Office publishing the Task's work.
 */
export type Stage = AgentStage | ScriptStage | Gate | PublishStage;

export type StageKind = Stage["kind"];

/** Each kind as the UI names it. */
export const STAGE_KIND_NAMES: Readonly<Record<StageKind, string>> = {
  agent: "Agent Stage",
  script: "Script Stage",
  gate: "Gate",
  publish: "Publish Stage",
};

/** What a Script Stage runs: a Project command by its key. */
export type ScriptStageCommand = string;

/**
 * A key no Project command takes, as publishing is the Publish Stage's (spec §2.3.4); a Pipeline
 * stored before Publish was a kind of its own names it as a Script Stage's command, which
 * `withPublishStages` reads as a Publish Stage.
 */
export const PUBLISH_COMMAND = "publish";

/** Whether `stage` is a Publish Stage. */
export function isPublishStage(stage: Stage | undefined): stage is PublishStage {
  return stage?.kind === "publish";
}

/** Whether `stage` publishes by the Project's publishing mode, so it can end Conflict. */
export function publishesByThePublishingMode(stage: Stage | undefined): stage is PublishStage {
  return isPublishStage(stage) && stage.publishTarget !== "branch-only";
}

/**
 * Where a Publish Stage takes the Task's branch (spec §2.3's proof-of-concept publish target): by
 * the Project's publishing mode, or pushed as a branch only, with no pull request and no merge.
 */
export type PublishTarget = "publishing-mode" | "branch-only";

/** Fresh with a Brief, or continuing the previous Stage's session when the same person worked it. */
export type StageSession = "fresh" | "continue";

/** How hard the model thinks, as the engine names it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

interface StageFields {
  /** Names the Stage within its Pipeline and stays when the Stage is renamed. */
  readonly key: string;
  readonly name: string;
  /**
   * Read only by the previous release, which skipped the Stage once the Definition of Done was met:
   * kept for a rollback, and written as routes by the conversion (`straightLineFlow`).
   */
  readonly optional: boolean;
  /**
   * Its routes out, in the order the walk weighs them. Absent only on a Stage template and a Stage a
   * Stage change gives; a Pipeline's and a Task's Stages carry them, read through `asFlow`.
   */
  readonly routes?: Route[];
  /** Absent where `routes` is. */
  readonly place?: StagePlace;
  /**
   * The Stage template it is linked to (spec §2.3.1), kept on an office-wide or Project Pipeline's
   * Stage alone (`domain/stage-template-link.ts`). Absent is unlinked.
   */
  readonly templateId?: string;
}

export interface AgentStage extends StageFields {
  readonly kind: "agent";
  /**
   * The key of the Role that works it. A Stage names a Role or a duty, never both (spec §2.3); read
   * it through `stageWorker`, or on the Stages `staffedStages` gives a Role to.
   */
  readonly role?: string;
  /** The duty whose holder works it, as held when the Stage starts. */
  readonly duty?: DutyKey;
  /** Plain words, filled with the Task's Plan, Definition of Done and earlier results. */
  readonly brief: string;
  readonly session: StageSession;
  /** Tokens the Stage may use; reaching them asks the user. */
  readonly budget: number;
  /** Absent keeps the Role's. */
  readonly effort?: Effort;
  /** Narrows the Role card's permission profile; absent keeps it whole. */
  readonly permissions?: StagePermissions;
  /** Its own context limits, or No limit; absent takes the Office defaults (spec §2.5). */
  readonly contextLimits?: StageContextLimitsOverride;
  /**
   * Merge the base first (spec §2.3.1): The Office merges the base into the Task's branch as the
   * Stage starts and leaves the conflicted files for its Agent. Absent is off.
   */
  readonly mergeBaseFirst?: boolean;
}

export interface ScriptStage extends StageFields {
  readonly kind: "script";
  readonly command: ScriptStageCommand;
}

/** The Office publishes the Task's work by its own git code (spec §2.3.4). */
export interface PublishStage extends StageFields {
  readonly kind: "publish";
  /** Absent means the Project's publishing mode. */
  readonly publishTarget?: PublishTarget;
}

/** The Task waits for the user to look at the work so far and let it continue. */
export interface Gate extends StageFields {
  readonly kind: "gate";
}

/** Who an Agent Stage names to work it: a Role, a duty, or nobody yet. */
export type StageWorker = { readonly role: string } | { readonly duty: DutyKey };

/**
 * Who `stage` names to work it; undefined for a Stage of another kind, or one naming nobody yet. A
 * Stage naming both is refused by `singleStageProblems`; read as naming its Role.
 */
export function stageWorker(stage: Stage): StageWorker | undefined {
  if (stage.kind !== "agent") return undefined;
  if (stage.role !== undefined && stage.role.trim() !== "") return { role: stage.role };
  if (stage.duty !== undefined) return { duty: stage.duty };
  return undefined;
}

/** The Roles and the duties the Agent Stages among `stages` name, each once. */
export interface StageWorkers {
  readonly roles: ReadonlySet<string>;
  readonly duties: ReadonlySet<DutyKey>;
}

/** Who the Agent Stages among `stages` name, Roles and duties apart. */
export function agentStageWorkers(stages: readonly Stage[]): StageWorkers {
  const workers = stages.flatMap((stage) => {
    const worker = stageWorker(stage);
    return worker ? [worker] : [];
  });
  return {
    roles: new Set(workers.flatMap((worker) => ("role" in worker ? [worker.role] : []))),
    duties: new Set(workers.flatMap((worker) => ("duty" in worker ? [worker.duty] : []))),
  };
}

/** Whether two Stages name the same Role, or the same duty: what "continue" needs. */
export function sameWorkerNamed(one: Stage, other: Stage): boolean {
  return isDeepStrictEqual(stageWorker(one), stageWorker(other));
}

/**
 * The Project commands, by key, that `stage` may run: a Script Stage's own, the keys an Agent Stage
 * narrows its Project commands to, and those its routes' command tests run (spec §2.3). The one
 * source every missing-command check reads.
 */
export function commandKeysOfStage(stage: Stage): readonly string[] {
  return [...ownCommandKeys(stage), ...commandKeysOfRoutes(stage.routes ?? [])];
}

function ownCommandKeys(stage: Stage): readonly string[] {
  if (stage.kind === "agent") return stage.permissions?.commands ?? [];
  if (stage.kind === "script") return [stage.command];
  return [];
}

/** The Project commands, by key, that `stages` may run, each once. */
export function commandKeysNamedBy(stages: readonly Stage[]): readonly string[] {
  return [...new Set(stages.flatMap(commandKeysOfStage))];
}

/** The Roles and duties a save of Stages newly names. */
export interface NewlyNamedWorkers {
  readonly roleKeys: readonly string[];
  readonly dutyKeys: readonly DutyKey[];
}

/** Those of `named` that `already` doesn't hold: who a save of Stages newly names. */
export function newlyNamedWorkers(named: StageWorkers, already: StageWorkers): NewlyNamedWorkers {
  return {
    roleKeys: [...named.roles].filter((roleKey) => !already.roles.has(roleKey)),
    dutyKeys: [...named.duties].filter((duty) => !already.duties.has(duty)),
  };
}

/** Everyone `workers` name, each once. */
export function mergedWorkers(...workers: readonly StageWorkers[]): StageWorkers {
  return {
    roles: new Set(workers.flatMap(({ roles }) => [...roles])),
    duties: new Set(workers.flatMap(({ duties }) => [...duties])),
  };
}

export const NO_STAGE_WORKERS: StageWorkers = { roles: new Set(), duties: new Set() };

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
