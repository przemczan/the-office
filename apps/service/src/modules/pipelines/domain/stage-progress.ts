import type { DutyKey } from "../../people/index.js";
import type { Stage } from "./stage.js";
import { staffedRole, staffedStages } from "./stage-staffing.js";
import {
  addTokens,
  NO_STAGE_TOKENS,
  type StageInterruption,
  type StageRun,
  type StageTokens,
} from "./stage-run.js";

/**
 * Where one of a started Task's Stages stands, as the Task page shows it: from its latest run, or
 * pending before its first. A run the user held with Pause or Stop, or the fire alarm held, is no
 * failure (spec §2.4, §2.8).
 */
export type StageState =
  "pending" | "running" | "waiting-on-you" | "paused" | "stopped" | "done" | "skipped" | "failed";

/** Where a failed run's on-failure loop went back to, and which time. */
export interface WentBack {
  readonly stageKey: string;
  readonly round: number;
  readonly rounds: number;
}

/** One of a started Task's Stages with its runs, for the Task page. */
export interface StageProgress {
  readonly stage: Stage;
  readonly state: StageState;
  /** The Stage's runs, oldest first. */
  readonly runs: readonly StageRun[];
  /** Every token its runs' engine calls used, by kind; budgets leave cache reads out. */
  readonly tokens: StageTokens;
  /** Set when its latest run failed and its loop went back to an earlier Stage. */
  readonly wentBack: WentBack | undefined;
  /**
   * For an Agent Stage naming a duty, the Role working it: its latest run's once started, the
   * duty's holder before; undefined while nobody holds it, and for any other Stage.
   */
  readonly workedBy: string | undefined;
}

/** A Task's own Stages with where each stands, as the Task page shows them. */
export interface TaskProgress {
  readonly stages: readonly StageProgress[];
  /** Whether the user edited the Stages for the Task, which the Pipeline's label says. */
  readonly editedForTask: boolean;
  /** How many Stages, from the first, have started and are locked (`lockedStageCount`). */
  readonly lockedStages: number;
  /** The Definition of Done statements Reported met, by their numbers (`reportedMet`). */
  readonly definitionOfDoneMet: readonly number[];
}

/** Each of the Task's Stages, in order, with where it stands from the Task's runs. */
export function stagesProgress(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  holders: ReadonlyMap<DutyKey, string> = new Map(),
): StageProgress[] {
  const staffed = staffedStages(stages, runs, holders);
  return stages.map((stage, index) => {
    const own = runs.filter(({ stageKey }) => stageKey === stage.key);
    const latest = own.at(-1);
    const staffedStage = staffed[index];
    return {
      stage,
      state: latest ? stateOf(stage, latest) : "pending",
      runs: own,
      tokens: own.reduce((sum, run) => addTokens(sum, run.tokens), NO_STAGE_TOKENS),
      wentBack: latest && wentBackFrom(latest, runs),
      workedBy:
        staffedStage?.kind === "agent" && staffedStage.duty !== undefined
          ? staffedRole(staffedStage)
          : undefined,
    };
  });
}

function stateOf(stage: Stage, { outcome, decisions, gateAction }: StageRun): StageState {
  if (!outcome) return "running";
  if (decisions.some(({ answer }) => answer === undefined)) return "waiting-on-you";
  switch (outcome.status) {
    case "done":
      if (stage.kind === "gate" && !gateAction) return "waiting-on-you";
      return outcome.skipped ? "skipped" : "done";
    // Its Decision opens just after the run ends; once answered, the Stage runs again.
    case "needs-decision":
      return decisions.length === 0 ? "waiting-on-you" : "done";
    case "failed":
      return heldState(outcome.interrupted) ?? "failed";
  }
}

/**
 * A restart stays a failure: The Office, not the user, ended the run. The fire alarm holds a run
 * as a Pause does.
 */
function heldState(interrupted: StageInterruption | undefined): StageState | undefined {
  if (interrupted === "pause" || interrupted === "alarm" || interrupted === "usage-window") {
    return "paused";
  }
  if (interrupted === "stop") return "stopped";
  return undefined;
}

function wentBackFrom(run: StageRun, runs: readonly StageRun[]): WentBack | undefined {
  if (run.outcome?.status !== "failed" || run.outcome.interrupted) return undefined;
  const next = runs.find(({ number }) => number === run.number + 1);
  const carried = next?.carriedFailure;
  if (!next || carried?.stageKey !== run.stageKey) return undefined;
  return { stageKey: next.stageKey, round: carried.round, rounds: carried.rounds };
}
