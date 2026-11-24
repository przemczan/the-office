/** The kinds an Action may be (spec §2.15, "Kinds"). */
export type ActionRunKind = "project-command" | "test-target" | "workflow";

/** A Project command run's states (spec §2.15, "States"). */
export type CommandRunState = "running" | "succeeded" | "failed" | "stopped";

/** A Test target run's states: its test instance's (spec §2.12, "Test instance states"). */
export type TestTargetRunState = "building" | "running" | "built" | "stopped" | "failed";

/** A Workflow run's states: Starting, then its CI run's status. */
export type WorkflowRunState =
  | "starting"
  | "queued"
  | "waiting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "unknown";

/** A CI run's status as the code host reports it, in words no code host owns. */
export type CiRunState = Exclude<WorkflowRunState, "starting">;

/** A run's state in its kind's own words. */
export type ActionRunStatus =
  | { readonly kind: "project-command"; readonly state: CommandRunState }
  | { readonly kind: "test-target"; readonly state: TestTargetRunState }
  | { readonly kind: "workflow"; readonly state: WorkflowRunState };

/** How a run ended, whatever its kind. */
export type ActionRunOutcome = "succeeded" | "failed" | "stopped";

/** Who a record names: the user's id and name. */
export interface ActionRunUser {
  readonly userId: string;
  readonly name: string;
}

/** What a run ran from (spec §2.15, "What it runs from"), with the Task's or Initiative's name. */
export type ActionRunRanFrom =
  | { readonly kind: "branch" }
  | { readonly kind: "task"; readonly taskId: string; readonly title: string }
  | { readonly kind: "initiative"; readonly initiativeId: string; readonly name: string };

/** A Workflow run's CI run, once it showed on the code host. */
export interface ActionRunCiRun {
  readonly id: number;
  readonly workflowName: string;
  readonly number: number;
  readonly url: string;
}

/** Why a run was stopped (spec §2.15, "When a run stops"). */
export type ActionRunStopReason =
  | { readonly kind: "by-user"; readonly user: ActionRunUser }
  | { readonly kind: "fire-alarm" }
  | { readonly kind: "actions-off"; readonly projectName: string }
  | { readonly kind: "restart" }
  | { readonly kind: "action-removed" };

/** One start of one Action (spec §2.15, "Action run"). */
export interface ActionRun {
  readonly id: string;
  readonly projectId: string;
  readonly actionKey: string;
  /** The Action's name and kind as they were at its start. */
  readonly actionName: string;
  readonly status: ActionRunStatus;
  /** Undefined while it is running. */
  readonly outcome: ActionRunOutcome | undefined;
  readonly ranFrom: ActionRunRanFrom;
  readonly branch: string;
  /** The commit it ran; a Workflow run's as its CI run reports it, undefined until known. */
  readonly commit: string | undefined;
  /** The commit the start's confirm step showed, or the tip fetched at the start. */
  readonly startCommit: string;
  /** "It ran <commit>: <branch> moved as it started.", for a Workflow run whose commit differs. */
  readonly note: string | undefined;
  readonly startedBy: ActionRunUser;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
  /** A Project command run's exit code, when its command ended with one. */
  readonly exitCode: number | undefined;
  /** Why it Failed or was Stopped, in the user's words. */
  readonly endedBecause: string | undefined;
  /** How it was stopped, when a stop ended it. */
  readonly stoppedBy: ActionRunStopReason["kind"] | undefined;
  /** A Test target run's test instance. */
  readonly testInstanceId: string | undefined;
  /** A Workflow run's file, which its CI run is found by. */
  readonly workflowFile: string | undefined;
  /** When The Office asked the code host to start a Workflow run; undefined until it asked. */
  readonly askedAt: Date | undefined;
  readonly ciRun: ActionRunCiRun | undefined;
  /** The Workflow's runs on the code host, linked when its CI run didn't show. */
  readonly workflowRunsUrl: string | undefined;
}

/** The newest runs of each Action kept with their logs (spec §2.15, "Action runs kept"). */
export const KEPT_RUNS = 20;

/** How long a Workflow run waits for its CI run to show (spec §2.15, "States"). */
export const WORKFLOW_SHOW_MS = 60_000;

/** How often a Starting Workflow run asks the code host for its CI run. */
export const WORKFLOW_SHOW_POLL_MS = 5_000;

/** How often a Workflow run's CI run is read while it runs. */
export const WORKFLOW_FOLLOW_POLL_MS = 15_000;

export function isRunning(run: Pick<ActionRun, "outcome">): boolean {
  return run.outcome === undefined;
}

/** A Test target run's outcome by its instance's state (spec §2.15, "States"). */
export function testTargetOutcomeOf(
  state: TestTargetRunState,
  stoppedByUser: boolean,
): ActionRunOutcome | undefined {
  switch (state) {
    case "building":
    case "running":
      return undefined;
    case "built":
      return "succeeded";
    case "stopped":
      return "stopped";
    case "failed":
      return stoppedByUser ? "stopped" : "failed";
  }
}

/** A Workflow run's outcome by its CI run's status: success, cancelled or skipped, else failed. */
export function workflowOutcomeOf(state: WorkflowRunState): ActionRunOutcome | undefined {
  switch (state) {
    case "starting":
    case "queued":
    case "waiting":
    case "running":
      return undefined;
    case "succeeded":
      return "succeeded";
    case "cancelled":
    case "skipped":
      return "stopped";
    case "failed":
    case "unknown":
      return "failed";
  }
}

/** What a new run is made of. */
export interface NewActionRun {
  readonly id: string;
  readonly projectId: string;
  readonly actionKey: string;
  readonly actionName: string;
  readonly kind: ActionRunKind;
  readonly ranFrom: ActionRunRanFrom;
  readonly branch: string;
  readonly startCommit: string;
  readonly startedBy: ActionRunUser;
  readonly at: Date;
  readonly testInstanceId?: string;
  readonly workflowFile?: string;
}

/** A run as it starts: Running, a Test target run Building, a Workflow run Starting. */
export function startedRun(given: NewActionRun): ActionRun {
  return {
    id: given.id,
    projectId: given.projectId,
    actionKey: given.actionKey,
    actionName: given.actionName,
    status: firstStatusOf(given.kind),
    outcome: undefined,
    ranFrom: given.ranFrom,
    branch: given.branch,
    commit: given.kind === "workflow" ? undefined : given.startCommit,
    startCommit: given.startCommit,
    note: undefined,
    startedBy: given.startedBy,
    startedAt: given.at,
    endedAt: undefined,
    exitCode: undefined,
    endedBecause: undefined,
    stoppedBy: undefined,
    testInstanceId: given.testInstanceId,
    workflowFile: given.workflowFile,
    askedAt: undefined,
    ciRun: undefined,
    workflowRunsUrl: undefined,
  };
}

function firstStatusOf(kind: ActionRunKind): ActionRunStatus {
  switch (kind) {
    case "project-command":
      return { kind, state: "running" };
    case "test-target":
      return { kind, state: "building" };
    case "workflow":
      return { kind, state: "starting" };
  }
}

/** A run's end as a Failed of its kind, saying why; undefined for one that has ended already. */
export function failedRun(
  run: ActionRun,
  because: string,
  at: Date,
  extra: Partial<Pick<ActionRun, "exitCode" | "workflowRunsUrl">> = {},
): ActionRun | undefined {
  if (!isRunning(run)) return undefined;
  return {
    ...run,
    ...extra,
    status: { kind: run.status.kind, state: "failed" } as ActionRunStatus,
    outcome: "failed",
    endedAt: at,
    endedBecause: because,
  };
}

/** A Project command run that ended with 0. */
export function succeededRun(run: ActionRun, at: Date): ActionRun | undefined {
  if (!isRunning(run) || run.status.kind !== "project-command") return undefined;
  return {
    ...run,
    status: { kind: "project-command", state: "succeeded" },
    outcome: "succeeded",
    endedAt: at,
    exitCode: 0,
  };
}

/** A Project command run stopped, saying who or what stopped it. */
export function stoppedRun(
  run: ActionRun,
  reason: ActionRunStopReason,
  at: Date,
): ActionRun | undefined {
  if (!isRunning(run) || run.status.kind !== "project-command") return undefined;
  return {
    ...run,
    status: { kind: "project-command", state: "stopped" },
    outcome: "stopped",
    endedAt: at,
    endedBecause: stopWords(reason),
    stoppedBy: reason.kind,
  };
}

/** A Test target run follows its instance's move; undefined when nothing would change. */
export function testTargetMoved(
  run: ActionRun,
  move: {
    readonly to: TestTargetRunState;
    readonly failedReason: string | undefined;
    readonly stoppedByUser: boolean;
  },
  at: Date,
): ActionRun | undefined {
  if (run.status.kind !== "test-target" || !isRunning(run)) return undefined;
  if (run.status.state === move.to) return undefined;
  const outcome = testTargetOutcomeOf(move.to, move.stoppedByUser);
  return {
    ...run,
    status: { kind: "test-target", state: move.to },
    outcome,
    endedAt: outcome === undefined ? undefined : at,
    endedBecause:
      move.to === "failed" || move.to === "stopped"
        ? (move.failedReason ?? run.endedBecause)
        : undefined,
    stoppedBy: move.stoppedByUser ? "by-user" : run.stoppedBy,
  };
}

/** A Test target run's instance recorded the commit it runs. */
export function withCommit(run: ActionRun, commit: string): ActionRun | undefined {
  return run.commit === commit ? undefined : { ...run, commit };
}

/** A Workflow run's start was asked of the code host. */
export function workflowAsked(run: ActionRun, askedAt: Date): ActionRun | undefined {
  if (run.status.kind !== "workflow" || !isRunning(run)) return undefined;
  return { ...run, askedAt };
}

/** A Workflow run's CI run as the code host reports it now; undefined when nothing changed. */
export function workflowFollowed(
  run: ActionRun,
  ciRun: ActionRunCiRun & { readonly commit: string; readonly status: CiRunState },
  at: Date,
): ActionRun | undefined {
  if (run.status.kind !== "workflow" || !isRunning(run)) return undefined;
  const { commit, status, ...shown } = ciRun;
  const outcome = workflowOutcomeOf(status);
  const changed: ActionRun = {
    ...run,
    status: { kind: "workflow", state: status },
    outcome,
    endedAt: outcome === undefined ? undefined : at,
    commit,
    note: commit.startsWith(run.startCommit) ? undefined : movedAsItStarted(commit, run.branch),
    ciRun: shown,
    endedBecause: outcome === "failed" ? workflowFailedWords(shown) : run.endedBecause,
  };
  return sameRun(run, changed) ? undefined : changed;
}

function sameRun(one: ActionRun, other: ActionRun): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/** The first 7 characters, as the UI shows a commit. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/** The note a Workflow run whose CI run ran another commit carries (spec §2.15, "States"). */
export function movedAsItStarted(commit: string, branch: string): string {
  return `It ran ${shortCommit(commit)}: ${branch} moved as it started.`;
}

function workflowFailedWords(ciRun: ActionRunCiRun): string {
  return `${ciRun.workflowName} #${ciRun.number} didn't succeed.`;
}

/** The words a stop writes on the run and last in its log. */
export function stopWords(reason: ActionRunStopReason): string {
  switch (reason.kind) {
    case "by-user":
      return `Stopped by ${reason.user.name}.`;
    case "fire-alarm":
      return "Stopped by the fire alarm.";
    case "actions-off":
      return `Actions were switched off for «${reason.projectName}».`;
    case "restart":
      return "The Office restarted while it ran.";
    case "action-removed":
      return "Stopped because the Action was removed.";
  }
}

/** A run's name as the Actions at once refusal names it: "Build web on main". */
export function runName(run: Pick<ActionRun, "actionName" | "branch">): string {
  return `${run.actionName} on ${run.branch}`;
}

/**
 * The runs past the newest `KEPT_RUNS` of one Action, newest first given, that have ended: what
 * the retention removes as a newer one ends.
 */
export function runsPastTheKept(newestFirst: readonly ActionRun[]): ActionRun[] {
  return newestFirst.slice(KEPT_RUNS).filter((run) => !isRunning(run));
}

/** How long ago, in words: "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function sinceWords(since: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - since.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The state in the user's words, as the Project's record (`list_projects`) names a last run. */
export function stateWords(status: ActionRunStatus): string {
  const words = status.state.charAt(0).toUpperCase() + status.state.slice(1);
  return words;
}
