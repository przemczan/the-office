import type {
  ActionRun,
  ActionRunOutcome,
  ActionRunSourceQuery,
  ProjectActionRuns,
} from "@the-office/contracts";
import { CI_RUN_STATUS_WORDS } from "../../../shell/ci-run-status-words.ts";
import {
  shortCommit,
  TEST_INSTANCE_STATE_TONES,
  TEST_INSTANCE_STATE_WORDS,
} from "../../../shell/test-instances/test-instance-words.ts";
import { durationWords, momentWords } from "../../../shell/time.ts";
import type { ToneWords } from "../../../shell/tone-words.ts";
import { userName } from "../../../shell/use-user-name.ts";
import type { BranchChoice } from "../branch-picker-words.ts";

/** An Action's runs, newest first, as the Project's runs list them; none before its first. */
export function runsOf(
  runs: ProjectActionRuns | undefined,
  actionKey: string,
): readonly ActionRun[] {
  return runs?.actions.find((history) => history.actionKey === actionKey)?.runs ?? [];
}

/** An Action's last run: its newest. */
export function lastRunOf(
  runs: ProjectActionRuns | undefined,
  actionKey: string,
): ActionRun | undefined {
  return runsOf(runs, actionKey)[0];
}

/** A run is running until it reaches an end state (spec §2.15, "States"). */
export function isRunning(run: Pick<ActionRun, "outcome">): boolean {
  return run.outcome === null;
}

export const NOT_RUN_YET = "Not run yet";

const OUTCOME_WORDS: Readonly<Record<ActionRunOutcome, Omit<ToneWords, "title">>> = {
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  stopped: { label: "Stopped", tone: "neutral" },
};

/** A run's state badge: its kind's own words, with why on hover once it Failed or Stopped. */
export interface RunStateWords extends ToneWords {
  /** Whether the badge spins: a command run Running, a Test target run Building, Starting. */
  readonly spinning: boolean;
}

export function runStateWords(
  run: Pick<ActionRun, "status" | "outcome" | "endedBecause">,
): RunStateWords {
  const why = run.endedBecause ?? "";
  const { status } = run;
  switch (status.kind) {
    case "project-command":
      if (status.state === "running") {
        return { label: "Running", tone: "info", title: "It is running now.", spinning: true };
      }
      return { ...OUTCOME_WORDS[status.state], title: why, spinning: false };
    case "test-target":
      return {
        label: TEST_INSTANCE_STATE_WORDS[status.state],
        tone: TEST_INSTANCE_STATE_TONES[status.state],
        title: why,
        spinning: status.state === "building",
      };
    case "workflow": {
      if (status.state === "starting") {
        return {
          label: "Starting",
          tone: "info",
          title: "The Office is waiting for the code host to show its run.",
          spinning: true,
        };
      }
      const words = CI_RUN_STATUS_WORDS[status.state];
      return { ...words, title: why === "" ? words.title : why, spinning: false };
    }
  }
}

/** What a run ran from: the branch, the Task's title or the Initiative's name. */
export function ranFromWords(run: Pick<ActionRun, "ranFrom" | "branch">): string {
  switch (run.ranFrom.kind) {
    case "branch":
      return run.branch;
    case "task":
      return run.ranFrom.title;
    case "initiative":
      return run.ranFrom.name;
  }
}

const DAY_MS = 24 * 60 * 60_000;

/** "18 min ago", "<1 min ago" within the day, "9 Nov, 10:05" before. */
export function agoWords(isoTime: string, now: Date = new Date()): string {
  const since = Math.max(0, now.getTime() - Date.parse(isoTime));
  return since < DAY_MS ? `${durationWords(since)} ago` : momentWords(isoTime, now);
}

/** Under an Action's row: "main · f00ba12 · 18 min ago", "<Task title> · f00ba12 · …". */
export function lastRunLine(run: ActionRun, now: Date = new Date()): string {
  const commit = shortCommit(run.commit);
  return [
    ranFromWords(run),
    ...(commit === undefined ? [] : [commit]),
    agoWords(run.startedAt, now),
  ].join(" · ");
}

/** Why Run is disabled while the last run runs. */
export function runningAlreadyWords(
  actionName: string,
  run: ActionRun,
  signedInUserId: string | undefined,
  now: Date = new Date(),
): string {
  return `${actionName} is running already, started by ${userName(run.startedBy, signedInUserId, "you")} ${agoWords(run.startedAt, now)}.`;
}

/** Who started a run, "you" for the signed-in user. */
export function startedByWords(run: ActionRun, signedInUserId: string | undefined): string {
  return userName(run.startedBy, signedInUserId, "you");
}

/** How long it took, or "for <n> min" while it runs. */
export function tookWords(run: ActionRun, now: Date = new Date()): string {
  if (run.endedAt === null) {
    return `for ${durationWords(now.getTime() - Date.parse(run.startedAt))}`;
  }
  return durationWords(Date.parse(run.endedAt) - Date.parse(run.startedAt));
}

/** The Run window's title. */
export function runWindowTitle(actionName: string): string {
  return `Run ${actionName}`;
}

/** While the tip of what was chosen is read. */
export function readingWords(branch: string): string {
  return `Reading ${branch}…`;
}

export function startedToast(actionName: string, branch: string): string {
  return `${actionName} started on ${branch}.`;
}

export function stoppedToast(actionName: string): string {
  return `${actionName} stopped.`;
}

/** A refusal of a start, in the Run window. */
export const DIDNT_START = "The Action didn't start";

/** A refusal of Stop, in the log window. */
export const DIDNT_STOP = "The run didn't stop";

/** Run from, fixed for an Action that leaves the workstation. */
export function fixedToBaseWords(baseBranch: string): string {
  return `It leaves the workstation, so it runs from ${baseBranch} only.`;
}

/** The confirm step's text. */
export function confirmWords(
  actionName: string,
  baseBranch: string,
  commit: string,
  subject: string,
): string {
  return `Run ${actionName} on ${baseBranch} at ${commit} (${subject})? What it pushes, publishes, deploys or releases reaches outside this Office.`;
}

/** The confirm step's danger button. */
export function confirmButtonWords(actionName: string, baseBranch: string, commit: string): string {
  return `Run ${actionName} on ${baseBranch} at ${commit}`;
}

/** The remove step for a running Action. */
export function removeRunningWords(actionName: string): string {
  return `Remove ${actionName}? Its running run stops first. Its runs and their logs are removed with it.`;
}

export const HISTORY_EMPTY = "Not run yet. Run it to see its runs here.";
export const HISTORY_FOOT = "The newest 20 runs are kept with their logs.";

/** The log window's title: "Release · Running". */
export function logTitle(run: ActionRun): string {
  return `${run.actionName} · ${runStateWords(run).label}`;
}

/** What a choice of the Branch picker reads and runs from. */
export function sourceOf(choice: BranchChoice): ActionRunSourceQuery {
  switch (choice.kind) {
    case "branch":
      return { kind: "branch", branch: choice.branch };
    case "task":
      return { kind: "task", taskId: choice.taskId };
    case "initiative":
      return { kind: "initiative", initiativeId: choice.initiativeId };
  }
}

/** The Actions tile: how many more than it shows. */
export function moreUnderActionsWords(count: number): string {
  return `${count} more under Actions`;
}

export const NO_ACTIONS_TILE =
  "No Actions yet: things to run on demand, such as an install on a phone or a release.";
