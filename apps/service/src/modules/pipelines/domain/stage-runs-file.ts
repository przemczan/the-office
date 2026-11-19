import { reportedMet, reportedOutOfReach } from "./definition-of-done-reports.js";
import type { Stage, StageKind } from "./stage.js";
import type { StageRun } from "./stage-run.js";

/** How a run ended, in the file's words. */
export type StageRunsFileOutcome = "done" | "skipped" | "failed" | "needs-decision" | "held";

/** A Definition of Done statement's state, in the file's words. */
export type StageRunsFileStatement =
  | { readonly number: number; readonly statement: string; readonly state: "reported-met" }
  | {
      readonly number: number;
      readonly statement: string;
      readonly state: "out-of-reach";
      readonly why: string;
    }
  | { readonly number: number; readonly statement: string; readonly state: "not-met" };

/** An ended run of the Task, in the file's words. */
export interface StageRunsFileRun {
  readonly stage: string;
  readonly name: string;
  readonly kind: StageKind;
  /** The Stage's own run count, from 1, as its Stage history numbers it. */
  readonly run: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outcome: StageRunsFileOutcome;
  readonly changedFiles: readonly string[];
  readonly handoverNote: string | null;
  readonly error: string | null;
  /** A Script Stage's key and its command's exit code, null when it didn't run; null for others. */
  readonly command: { readonly key: string; readonly exitCode: number | null } | null;
}

/**
 * The file of the Task's earlier Stage runs a condition command reads from `OFFICE_STAGE_RUNS_FILE`
 * (spec §2.3, "The Project-command condition"), version 1, which later versions only add to.
 */
export interface StageRunsFile {
  readonly version: 1;
  readonly task: { readonly id: string; readonly title: string; readonly project: string };
  /** `to` is a Stage's key, or null for End. */
  readonly route: { readonly from: string; readonly to: string | null };
  readonly definitionOfDone: readonly StageRunsFileStatement[];
  readonly stageRuns: readonly StageRunsFileRun[];
}

/** The Task the file is of. */
export interface StageRunsFileTask {
  readonly id: string;
  readonly title: string;
  /** The Project's id. */
  readonly project: string;
}

/**
 * The file for the route being weighed: every run of the Task that ended, Resolve's among them, in
 * the order they started, so the run the route leaves is last. `stages` are the Stages the walk
 * walked, Resolve's included, which name each run's Stage and kind.
 */
export function stageRunsFile(
  task: StageRunsFileTask,
  route: StageRunsFile["route"],
  definitionOfDone: readonly string[],
  runs: readonly StageRun[],
  stages: readonly Stage[],
): StageRunsFile {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const runCounts = new Map<string, number>();
  const stageRuns: StageRunsFileRun[] = [];
  for (const run of runs) {
    const count = (runCounts.get(run.stageKey) ?? 0) + 1;
    runCounts.set(run.stageKey, count);
    const ended = fileRunOf(run, count, byKey.get(run.stageKey));
    if (ended) stageRuns.push(ended);
  }
  return {
    version: 1,
    task,
    route,
    definitionOfDone: statementsOf(definitionOfDone, runs),
    stageRuns,
  };
}

function statementsOf(
  definitionOfDone: readonly string[],
  runs: readonly StageRun[],
): StageRunsFileStatement[] {
  const met = new Set(reportedMet(runs));
  const outOfReach = new Map(
    reportedOutOfReach(runs).map(({ statement, why }) => [statement, why]),
  );
  return definitionOfDone.map((statement, index) => {
    const number = index + 1;
    if (met.has(number)) return { number, statement, state: "reported-met" };
    const why = outOfReach.get(number);
    if (why !== undefined) return { number, statement, state: "out-of-reach", why };
    return { number, statement, state: "not-met" };
  });
}

/** The run in the file's words; undefined while it hasn't ended. */
function fileRunOf(
  run: StageRun,
  count: number,
  stage: Stage | undefined,
): StageRunsFileRun | undefined {
  const { outcome, endedAt } = run;
  if (!outcome || !endedAt) return undefined;
  const kind = stage?.kind ?? kindOfRun(run);
  return {
    stage: run.stageKey,
    name: stage?.name ?? run.stageKey,
    kind,
    run: count,
    startedAt: run.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    outcome: outcomeOf(outcome),
    changedFiles: run.changedFiles ?? [],
    handoverNote: outcome.handoverNote ?? null,
    error: outcome.status === "failed" && !outcome.interrupted ? outcome.error : null,
    command: stage?.kind === "script" ? { key: stage.command, exitCode: exitCodeOf(run) } : null,
  };
}

/**
 * A run kept for a Stage the Task's Stages no longer have: an Agent's has a Role, a Gate's an
 * action, and any other is a Script Stage's.
 */
function kindOfRun(run: StageRun): StageKind {
  if (run.roleKey !== undefined) return "agent";
  return run.gateAction ? "gate" : "script";
}

/** An interrupted run is never counted a failure: its Stage runs again, so it was held. */
function outcomeOf(outcome: NonNullable<StageRun["outcome"]>): StageRunsFileOutcome {
  switch (outcome.status) {
    case "done":
      return outcome.skipped ? "skipped" : "done";
    case "needs-decision":
      return "needs-decision";
    case "failed":
      return outcome.interrupted ? "held" : "failed";
  }
}

/** The exit code of the Script Stage's command's last run; null when it never exited by itself. */
function exitCodeOf({ commandRuns }: StageRun): number | null {
  const last = commandRuns.findLast(({ purpose }) => purpose === "command" || purpose === "re-run");
  return last?.exitCode ?? null;
}
