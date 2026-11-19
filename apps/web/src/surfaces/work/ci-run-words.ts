import type { CiRun, CiRunProblem, CiRunStatus } from "@the-office/contracts";
import { clockOf } from "../../shell/time.ts";
import { checkedWords, type ToneWords } from "./pull-request-words.ts";

/** A CI run's status as the Status column shows it. */
export const CI_RUN_STATUS_WORDS: Readonly<Record<CiRunStatus, ToneWords>> = {
  queued: { label: "Queued", tone: "neutral", title: "It is waiting for a runner to pick it up." },
  waiting: {
    label: "Waiting",
    tone: "warning",
    title: "It is waiting, such as for an approval or another run.",
  },
  running: { label: "Running", tone: "info", title: "It is running now." },
  succeeded: { label: "Succeeded", tone: "success", title: "Every job passed." },
  failed: { label: "Failed", tone: "danger", title: "At least one job failed." },
  cancelled: { label: "Cancelled", tone: "neutral", title: "It was cancelled before it ended." },
  skipped: { label: "Skipped", tone: "neutral", title: "It was skipped and didn't run." },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    title: "The code host's status isn't one The Office knows.",
  },
};

/** Statuses a re-run is offered for. */
export function canRerun(run: Pick<CiRun, "status">): boolean {
  return run.status === "failed" || run.status === "cancelled";
}

/** "CI #118 · Add the sign-in page". */
export function ciRunName(run: Pick<CiRun, "workflow" | "number" | "title">): string {
  return `${run.workflow} #${run.number} · ${run.title}`;
}

/** The first seven characters of a commit. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/** When it started, as "18 min ago", or "Not started yet". */
export function startedWords(startedAt: string | null, now: Date = new Date()): string {
  return startedAt === null ? "Not started yet" : checkedWords(startedAt, now);
}

export const REFRESH_HINT = "Read from the code host every minute, and on Refresh.";

export const OUT_OF_DATE = "Out of date";
export const OUT_OF_DATE_TITLE =
  "The last refresh couldn't read this Project's CI runs, so what it shows may be out of date.";

export const NO_CI_RUNS =
  "No CI runs yet. A Project whose code host runs a workflow on a push or a pull request shows its runs here.";

export const IN_OTHER_PROJECTS = { one: "CI run", many: "CI runs" } as const;

export const RERUN_ALL = "Re-run all jobs";
export const RERUN_FAILED = "Re-run failed jobs";

/** The line over a Project's problem. */
export function problemTitle(projectName: string): string {
  return `${projectName}'s CI runs weren't refreshed`;
}

/** Why, in the user's own time: the code host's words, or "GitHub couldn't be reached at 14:02." */
export function problemWords(problem: CiRunProblem): string {
  if (problem.kind === "cannot-read") return problem.text;
  return `${problem.codeHost} couldn't be reached at ${clockOf(problem.failedAt)}.`;
}
