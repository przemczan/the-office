import type { StageRun } from "./stage-run.js";

/**
 * Whether a run of the Stage `stageKey` starts at a Stage boundary, where the fire alarm sounded
 * after the current Stages holds the Task (spec §2.8): every run but the one going on with the
 * Stage whose last run asked the user a Decision, which is still that Stage's work.
 */
export function startsAtStageBoundary(stageKey: string, runs: readonly StageRun[]): boolean {
  const last = runs.at(-1);
  return last?.stageKey !== stageKey || last.outcome?.status !== "needs-decision";
}
