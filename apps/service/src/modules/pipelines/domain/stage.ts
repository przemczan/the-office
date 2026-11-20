import { isDeepStrictEqual } from "node:util";
import type { DutyKey } from "../../people/index.js";
import { RESOLVE_TEST_COMMAND } from "./resolve-stages.js";
import { commandKeysOfRoutes, type Route, type StagePlace } from "./route.js";
import type { StageContextLimitsOverride } from "./stage-context-limits.js";
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
 * What a Script Stage runs: a Project command by its key, or `PUBLISH_COMMAND`, the Project's
 * publishing mode, run by The Office's own git code rather than a command line (spec §9).
 */
export type ScriptStageCommand = string;

/** The command of a Publish Stage, kept from every Project command's keys. */
export const PUBLISH_COMMAND = "publish";

/** Whether `stage` is a Publish Stage: a Script Stage running `PUBLISH_COMMAND`. */
export function isPublishStage(stage: Stage | undefined): stage is ScriptStage {
  return stage?.kind === "script" && stage.command === PUBLISH_COMMAND;
}

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

/** Fresh with a Brief, or continuing the previous Stage's session when the same person worked it. */
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
 * The Project commands, by key, that `stage` among `stages` may run: a Script Stage's own, the
 * Project's `test` for a Publish by the publishing mode, whose conflict Resolve and its Test take
 * when an Agent Stage can work Resolve, the keys an Agent Stage narrows its Project commands to,
 * and those its routes' command tests run (spec §2.3). The one source every missing-command check
 * reads.
 */
export function commandKeysOfStage(stage: Stage, stages: readonly Stage[]): readonly string[] {
  return [...ownCommandKeys(stage, stages), ...commandKeysOfRoutes(stage.routes ?? [])];
}

function ownCommandKeys(stage: Stage, stages: readonly Stage[]): readonly string[] {
  if (stage.kind === "agent") return stage.permissions?.commands ?? [];
  if (stage.kind !== "script") return [];
  if (stage.command !== PUBLISH_COMMAND) return [stage.command];
  const resolvable =
    stage.publishTarget !== "branch-only" && stages.some(({ kind }) => kind === "agent");
  return resolvable ? [RESOLVE_TEST_COMMAND] : [];
}

/** The Project commands, by key, that `stages` may run, each once. */
export function commandKeysNamedBy(stages: readonly Stage[]): readonly string[] {
  return [...new Set(stages.flatMap((stage) => commandKeysOfStage(stage, stages)))];
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
