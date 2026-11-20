import { ProjectRefused } from "./project-refused.js";
import { taskIdOfBranch } from "./pull-request.js";

/** Where a CI run stands, in words no code host owns. */
export type CiRunStatus =
  "queued" | "waiting" | "running" | "succeeded" | "failed" | "cancelled" | "skipped" | "unknown";

/** Which jobs of a CI run run again: all of them, or only the ones that failed. */
export type CiRunJobs = "all" | "failed";

/** What of a CI run its rules read. */
export interface CiRunFacts {
  readonly number: number;
  readonly workflow: string;
  readonly branch: string | null;
  readonly status: CiRunStatus;
}

const RERUNNABLE: ReadonlySet<CiRunStatus> = new Set(["failed", "cancelled"]);
const GOING: ReadonlySet<CiRunStatus> = new Set(["queued", "waiting", "running"]);

/** Only a failed or cancelled run runs again; refuses any other in plain words. */
export function ensureRerunnable(run: CiRunFacts): void {
  if (RERUNNABLE.has(run.status)) return;
  throw new ProjectRefused([
    `${run.workflow} #${run.number} is ${run.status}, so it can't be re-run: only a failed or cancelled CI run can.`,
  ]);
}

/** Whether the run is still going, so its Project's runs are listed again sooner. */
export function isGoing(run: CiRunFacts): boolean {
  return GOING.has(run.status);
}

/** The Task whose `office/<task id>` branch the run ran on, if it ran on one. */
export function taskIdOf(run: CiRunFacts): string | null {
  return run.branch === null ? null : (taskIdOfBranch(run.branch) ?? null);
}
