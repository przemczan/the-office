import { isPublishStage, type Stage } from "./stage.js";
import { publishResultOf } from "./publish-result.js";
import type { HoldingUser, StageRun, StartedOver } from "./stage-run.js";

/**
 * The Task's runs since its latest Start over (spec §2.4.5, "Start over"), oldest first: the runs
 * before it are history only, so the walk, the rail, routes' times, Not taken and Reported met read
 * these alone. Every run when it was never started over.
 */
export function runsOfLatestStart(runs: readonly StageRun[]): readonly StageRun[] {
  const last = runs.findLastIndex(({ startedOver }) => startedOver !== undefined);
  return last < 0 ? runs : runs.slice(last + 1);
}

/** Whether the run is of an earlier start, at or before the Task's latest Start over. */
export function isOfEarlierStart(run: StageRun, runs: readonly StageRun[]): boolean {
  const last = runs.findLastIndex(({ startedOver }) => startedOver !== undefined);
  return last >= 0 && run.number <= (runs[last]?.number ?? 0);
}

/** How many times the Task was started over before. */
export function startOversOf(runs: readonly StageRun[]): number {
  return runs.filter(({ startedOver }) => startedOver !== undefined).length;
}

/** The local ref that keeps the branch's old head at the Task's `number`th Start over. */
export function startedOverRef(taskId: string, number: number): string {
  return `refs/office/started-over/${taskId}/${number}`;
}

/**
 * Whether a Publish Stage of the Task pushed its branch or opened a pull request: a Publish run with
 * the result Published, a publication kept before its after line ran, or a pull request opened, in
 * any start of it, as the branch left the workstation then.
 */
export function workLeftTheWorkstation(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): boolean {
  const publishKeys = new Set(stages.filter(isPublishStage).map(({ key }) => key));
  return runs.some((run) => {
    if (run.published !== undefined) return true;
    const { outcome } = run;
    if (outcome?.status === "done" && outcome.pullRequestUrl !== undefined) return true;
    if (!publishKeys.has(run.stageKey)) return false;
    const result = publishResultOf(run);
    return result === "published" || result === "after-publishing-failed";
  });
}

/** The Start over kept on the last run before it. */
export function startOverRecord(
  number: number,
  byUser: HoldingUser,
  at: Date,
  reset: { readonly resetTo: string; readonly keptRef: string } | undefined,
): StartedOver {
  return {
    number,
    byUser: { userId: byUser.userId, name: byUser.name },
    at: at.toISOString(),
    resetTo: reset?.resetTo,
    keptRef: reset?.keptRef,
  };
}
