import type { CiRun } from "@the-office/contracts";
import { checkedWords } from "../../shell/code-host-words.ts";

/** Statuses a re-run is offered for. */
export function canRerun(run: Pick<CiRun, "status">): boolean {
  return run.status === "failed" || run.status === "cancelled";
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

export const START_A_WORKFLOW = "Start a workflow";
export const START_A_WORKFLOW_HINT =
  "Starts a GitHub Actions workflow whose file declares workflow_dispatch, on a branch or tag.";
export const START = "Start";
export const START_REFUSED = "The workflow wasn't started";

export const PROJECT_LABEL = "Project";
export const CHOOSE_PROJECT = "Choose a Project";
export const NO_PROJECT_TO_START_IN =
  "No Project lists CI runs yet. A Project whose repository is on GitHub shows here.";

export const REF_LABEL = "Branch or tag";
export const REF_HINT = "The workflow runs on this ref, with its file as it is there.";
export const REF_PLACEHOLDER = "Find a branch or tag";
export const CLEAR_REF = "Clear the branch or tag";
export const NO_REF_MATCHES = "No branch or tag matches";

export const WORKFLOW_LABEL = "Workflow";
export const CHOOSE_WORKFLOW = "Choose a workflow";
export const LOADING_WORKFLOWS = "Reading the workflows…";

/** A tag in the branch or tag list: "v1.2.0 (tag)". */
export function tagLabel(tag: string): string {
  return `${tag} (tag)`;
}

/** The workflow list's empty state on a ref. */
export function noWorkflowOn(ref: string): string {
  return `No workflow on ${ref} can be started by hand. A workflow can once its file there declares workflow_dispatch.`;
}

/** Why Start can't be pressed yet; undefined once it can. */
export function whyStartDisabled({
  ref,
  workflowChosen,
  missing,
}: {
  readonly ref: string;
  readonly workflowChosen: boolean;
  readonly missing: readonly string[];
}): string | undefined {
  if (ref === "") return "Choose a branch or tag first.";
  if (!workflowChosen) return "Choose a workflow first.";
  if (missing.length > 0) return `Give ${missing.join(", ")} a value first.`;
  return undefined;
}

/** The toast once the code host took the start. */
export function startedToast(workflowName: string, ref: string): string {
  return `${workflowName} started on ${ref}. Its run shows here once GitHub queues it.`;
}
