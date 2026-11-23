import { reportedMet, reportedOutOfReach } from "./definition-of-done-reports.js";
import { publishResultOf, type PublishResult } from "./publish-result.js";
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
  /**
   * A Publish run's result but Failed, its `outcome` then done; a Failed one is null with its
   * `outcome` failed, and so is any other run.
   */
  readonly result: Exclude<PublishResult, "failed"> | null;
  /** The route an Agent chose with its reason; null until Agents choose routes. */
  readonly choice: { readonly to: string | null; readonly reason: string } | null;
  readonly changedFiles: readonly string[];
  readonly handoverNote: string | null;
  readonly error: string | null;
  /**
   * A Script Stage's command key and its exit code, null when it didn't run; null for others, a
   * Publish Stage's among them.
   */
  readonly command: { readonly key: string; readonly exitCode: number | null } | null;
}

/**
 * The file of the Task's earlier Stage runs a condition command reads from `OFFICE_STAGE_RUNS_FILE`
 * (spec §2.3.2, "The stage runs file"), version 2, which adds to version 1 the `publish` kind, a
 * Publish run's `result` and an Agent's `choice`; later versions only add to it.
 */
export interface StageRunsFile {
  readonly version: 2;
  readonly task: { readonly id: string; readonly title: string; readonly project: string };
  /**
   * The route being weighed: `to` is a Stage's key, or null for End; `times` counts the times the
   * walk followed it before, and `limit` the times it may, null for No limit.
   */
  readonly route: {
    readonly from: string;
    readonly to: string | null;
    readonly times: number;
    readonly limit: number | null;
  };
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
 * The file for the route being weighed: every run of the Task that ended, in the order they started,
 * so the run the route leaves is last. `stages` are the Task's Stages as the walk reads them
 * (`asFlow`), which name each run's Stage and kind.
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
    version: 2,
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
  const result = kind === "publish" ? fileResultOf(run) : null;
  // A Publish run that ended with a named result ran through, whatever status it was stored with:
  // its `result` says how it went (spec §2.3.2, "The stage runs file").
  const ranThrough = result !== null;
  return {
    stage: run.stageKey,
    name: stage?.name ?? run.stageKey,
    kind,
    run: count,
    startedAt: run.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    outcome: ranThrough ? "done" : outcomeOf(outcome),
    result,
    choice: run.choice ? { to: run.choice.to, reason: run.choice.reason } : null,
    changedFiles: run.changedFiles ?? [],
    handoverNote: outcome.handoverNote ?? null,
    error:
      outcome.status === "failed" && !outcome.interrupted && !ranThrough ? outcome.error : null,
    command: stage?.kind === "script" ? { key: stage.command, exitCode: exitCodeOf(run) } : null,
  };
}

/**
 * A run kept for a Stage the Task's Stages no longer have: an Agent's has a Role, a Gate's an
 * action, a Publish Stage's a result, and any other is a Script Stage's.
 */
function kindOfRun(run: StageRun): StageKind {
  if (run.roleKey !== undefined) return "agent";
  if (run.gateAction) return "gate";
  return run.outcome?.status !== "needs-decision" && run.outcome?.publishResult !== undefined
    ? "publish"
    : "script";
}

/** A Publish run's result in the file's words: Failed is its `outcome`'s, so null. */
function fileResultOf(run: StageRun): StageRunsFileRun["result"] {
  const result = publishResultOf(run);
  return result === undefined || result === "failed" ? null : result;
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
