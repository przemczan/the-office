import type { Stage } from "./stage.js";
import { budgetTokens, type StageInterruption, type StageRun } from "./stage-run.js";

/**
 * Where one of a started Task's Stages stands, as the Task page shows it: from its latest run, or
 * pending before its first. A run the user held with Pause or Stop is no failure (spec §2.4).
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
  /** Every token its runs' engine calls used, counted as budgets count them. */
  readonly tokens: number;
  /** Set when its latest run failed and its loop went back to an earlier Stage. */
  readonly wentBack: WentBack | undefined;
}

/** Each of the Task's Stages, in order, with where it stands from the Task's runs. */
export function stagesProgress(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): StageProgress[] {
  return stages.map((stage) => {
    const own = runs.filter(({ stageKey }) => stageKey === stage.key);
    const latest = own.at(-1);
    return {
      stage,
      state: latest ? stateOf(latest) : "pending",
      runs: own,
      tokens: own.reduce((sum, run) => sum + budgetTokens(run.tokens), 0),
      wentBack: latest && wentBackFrom(latest, runs),
    };
  });
}

function stateOf({ outcome, decisions }: StageRun): StageState {
  if (!outcome) return "running";
  if (decisions.some(({ answer }) => answer === undefined)) return "waiting-on-you";
  switch (outcome.status) {
    case "done":
      return outcome.skipped ? "skipped" : "done";
    // Its Decision opens just after the run ends; once answered, the Stage runs again.
    case "needs-decision":
      return decisions.length === 0 ? "waiting-on-you" : "done";
    case "failed":
      return heldState(outcome.interrupted) ?? "failed";
  }
}

/** A restart stays a failure: The Office, not the user, ended the run. */
function heldState(interrupted: StageInterruption | undefined): StageState | undefined {
  if (interrupted === "pause") return "paused";
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
