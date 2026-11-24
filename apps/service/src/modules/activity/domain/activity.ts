/** How long an ended item stays listed for a user who hasn't seen it (spec §2.14, Defaults). */
export const ENDED_KEPT_DAYS = 7;
/** How long what a user has seen is kept, well past the items it hides (spec §2.14, Defaults). */
export const SEEN_KEPT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Task states at a desk, which Activity lists as running. */
const AT_A_DESK: ReadonlySet<string> = new Set(["in-progress", "waiting-on-you", "paused"]);
const ENDED_TEST_INSTANCE_STATES: ReadonlySet<string> = new Set(["built", "failed"]);
const LISTED_TEST_INSTANCE_STATES: ReadonlySet<string> = new Set([
  "building",
  "running",
  ...ENDED_TEST_INSTANCE_STATES,
]);
const GOING_CI_RUN_STATUSES: ReadonlySet<string> = new Set(["queued", "waiting", "running"]);
const PASSING_CHECKS: ReadonlySet<string> = new Set(["passing", "none"]);

/** A Task as Activity reads it, from Work. */
export interface ActivityTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly state: string;
  readonly createdAt: Date;
  /** When it was Done or Dropped; undefined while open. */
  readonly endedAt: Date | undefined;
  /** What The Office made it for, if anything: an Off-board Task's is listed as its own kind. */
  readonly madeFor?: string | undefined;
}

/** One of a Task's kept state changes. */
export interface ActivityStateChange {
  readonly to: string;
  readonly at: Date;
}

/** A started Task with its state changes and its own Stages, oldest first. */
export interface StartedActivityTask {
  readonly task: ActivityTask;
  readonly stateChanges: readonly ActivityStateChange[];
  readonly stages: readonly ActivityStage[];
}

/** One of a Task's Stages, with where it stands and its runs, oldest first, from Pipelines. */
export interface ActivityStage {
  readonly stage: { readonly name: string };
  readonly state: string;
  readonly runs: readonly {
    readonly id: string;
    readonly startedAt: Date;
    readonly endedAt: Date | undefined;
  }[];
}

/** The item kind of each Off-board Task, by what The Office made it for (spec §2.1). */
const OFF_BOARD_ITEM_KINDS: Readonly<Record<string, OffBoardItemKind>> = {
  onboard: "onboarding",
  "run-environment-setup": "run-environment-set-up",
};
type OffBoardItemKind = "onboarding" | "run-environment-set-up";

/** Whether Activity lists the Task as an Off-board Task's item, never as a `task` one. */
export function isOffBoard(task: Pick<ActivityTask, "madeFor">): boolean {
  return task.madeFor !== undefined && Object.hasOwn(OFF_BOARD_ITEM_KINDS, task.madeFor);
}

/**
 * An Off-board Task, a Project's Onboard Task or its "Set up the run environment" Task, as Work
 * reads it: `failed` is a Stage out of tries with its Decision open; `ready` waits for Start.
 */
export interface ActivityOffBoardTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  /** What The Office made it for: `onboard` or `run-environment-setup`. */
  readonly kind: string;
  readonly status:
    | {
        readonly state: "queued";
        readonly place: number;
        readonly shortReasons: readonly string[];
      }
    | { readonly state: "running" | "waiting-on-you" | "paused" | "ready" }
    | { readonly state: "failed"; readonly stageName: string }
    | { readonly state: "done" | "dropped"; readonly endedAt: Date | undefined };
  /** The Stage of its latest run; undefined before it started. */
  readonly currentStage: string | undefined;
  /** When it entered its state. */
  readonly since: Date;
  readonly tokens: number;
}

export interface ActivityTestInstance {
  readonly id: string;
  readonly projectId: string;
  readonly initiativeId: string | undefined;
  readonly branch: string | undefined;
  readonly targetName: string;
  readonly kind: string;
  readonly state: string;
  readonly launchedAt: Date;
  readonly runningAt: Date | undefined;
  readonly endedAt: Date | undefined;
}

/** A Project command run of an Action, running now. */
export interface ActivityActionRun {
  readonly id: string;
  readonly projectId: string;
  readonly actionKey: string;
  readonly actionName: string;
  readonly branch: string;
  /** Who started it, by name. */
  readonly startedBy: string;
  readonly startedAt: Date;
}

export interface ActivityCiRun {
  readonly id: number;
  readonly attempt: number;
  readonly projectId: string;
  readonly taskId: string | null;
  readonly workflow: string;
  readonly title: string;
  readonly status: string;
  readonly startedAt: Date | null;
  readonly updatedAt: Date;
  readonly url: string;
}

export interface ActivityEnvironmentCheck {
  readonly projectId: string;
  readonly state: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | undefined;
}

export interface ActivityDevice {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly name: string;
  readonly state: string;
  readonly connectedAt: Date;
}

export interface ActivityPullRequest {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: string;
  readonly checks: string;
  readonly mergeable: string;
  readonly stale: boolean;
  readonly openedAt: Date;
  readonly checkedAt: Date | null;
}

/** Everything Activity gathers from the modules that own it, for one read. */
export interface ActivityParts {
  readonly started: readonly StartedActivityTask[];
  /** The Tasks Done within the last `ENDED_KEPT_DAYS`. */
  readonly done: readonly ActivityTask[];
  /** The Task ids with a Decision open on them, waiting on the user. */
  readonly openDecisionTaskIds: ReadonlySet<string>;
  /** Every Off-board Task off the Archive. */
  readonly offBoardTasks: readonly ActivityOffBoardTask[];
  readonly testInstances: readonly ActivityTestInstance[];
  /** The Project command runs running now. */
  readonly actionRuns: readonly ActivityActionRun[];
  readonly ciRuns: readonly ActivityCiRun[];
  readonly environmentChecks: readonly ActivityEnvironmentCheck[];
  readonly devices: readonly ActivityDevice[];
  readonly pullRequests: readonly ActivityPullRequest[];
}

interface ItemFields {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly since: Date;
  readonly ended: boolean;
  readonly endedAt: Date | undefined;
  readonly link: ActivityLink;
}

export type ActivityLink =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "url"; readonly url: string };

/** One thing The Office is doing, or did and the user hasn't seen (spec §2.14). */
export type ActivityItem = ItemFields &
  (
    | { readonly kind: "task"; readonly taskId: string; readonly state: string }
    | {
        readonly kind: OffBoardItemKind;
        readonly taskId: string;
        readonly state: string;
        readonly stageName: string | null;
        readonly tokens: number;
        readonly queued: {
          readonly place: number;
          readonly shortReasons: readonly string[];
        } | null;
      }
    | {
        readonly kind: "stopped-task" | "failed-task";
        readonly taskId: string;
        readonly stageName: string;
      }
    | {
        readonly kind: "test-instance";
        readonly instanceId: string;
        readonly testInstanceKind: string;
        readonly state: string;
        readonly branch: string | null;
        readonly initiativeId: string | null;
      }
    | {
        readonly kind: "action-run";
        readonly runId: string;
        readonly actionKey: string;
        readonly branch: string;
        readonly startedBy: string;
      }
    | {
        readonly kind: "ci-run";
        readonly runId: number;
        readonly status: string;
        readonly url: string;
        readonly taskId: string | null;
      }
    | { readonly kind: "environment-check"; readonly state: string }
    | {
        readonly kind: "connected-device";
        readonly deviceId: string;
        readonly deviceKind: string;
        readonly state: string;
        readonly taskId: string;
      }
    | {
        readonly kind: "pull-request";
        readonly pullRequestId: string;
        readonly number: number;
        readonly url: string;
        readonly taskId: string;
      }
  );

export interface Activity {
  readonly items: readonly ActivityItem[];
  /** The running items and the ended ones the user hasn't seen: every item listed. */
  readonly count: number;
}

/** Where ended items start to be left out, whether seen or not. */
export function endedCutOf(now: Date): Date {
  return new Date(now.getTime() - ENDED_KEPT_DAYS * DAY_MS);
}

/** Before this, what a user has seen is forgotten. */
export function seenCutOf(now: Date): Date {
  return new Date(now.getTime() - SEEN_KEPT_DAYS * DAY_MS);
}

/**
 * The user's Activity: every part's items, less the ended ones they have seen or that ended over
 * `ENDED_KEPT_DAYS` ago; the running first, then the newest first.
 */
export function activityOf(
  parts: ActivityParts,
  seenIds: ReadonlySet<string>,
  now: Date,
): Activity {
  const cut = endedCutOf(now).getTime();
  const items = itemsOf(parts)
    .filter(
      ({ id, ended, endedAt }) => !ended || (!seenIds.has(id) && (endedAt?.getTime() ?? 0) >= cut),
    )
    .toSorted(
      (first, second) =>
        Number(first.ended) - Number(second.ended) ||
        second.since.getTime() - first.since.getTime() ||
        first.id.localeCompare(second.id),
    );
  return { items, count: items.length };
}

function itemsOf(parts: ActivityParts): ActivityItem[] {
  const offBoard = new Set(parts.offBoardTasks.map(({ taskId }) => taskId));
  const onBoard = (task: ActivityTask) => !offBoard.has(task.id) && !isOffBoard(task);
  return [
    ...parts.started
      .filter(({ task }) => onBoard(task))
      .flatMap((started) => startedTaskItem(started, parts.openDecisionTaskIds)),
    ...parts.done.filter(onBoard).map(doneTaskItem),
    ...parts.offBoardTasks.flatMap(offBoardTaskItem),
    ...parts.testInstances.flatMap(testInstanceItem),
    ...parts.actionRuns.map(actionRunItem),
    ...parts.ciRuns.map(ciRunItem),
    ...parts.environmentChecks.map(environmentCheckItem),
    ...parts.devices.flatMap(deviceItem),
    ...parts.pullRequests.flatMap(pullRequestItem),
  ];
}

/**
 * A started Task, never an Off-board Task, is `failed-task` or `stopped-task` while its current
 * Stage, the one run last, is failed or stopped and no Decision is open on it, keyed by that run so
 * a later one shows again; any other is `task`, since its last state change.
 */
function startedTaskItem(
  { task, stateChanges, stages }: StartedActivityTask,
  openDecisionTaskIds: ReadonlySet<string>,
): ActivityItem[] {
  if (!AT_A_DESK.has(task.state)) return [];
  const fields = { projectId: task.projectId, title: task.title, link: taskLink(task.id) };
  const current = currentStageOf(stages);
  if (
    current &&
    (current.stage.state === "failed" || current.stage.state === "stopped") &&
    !openDecisionTaskIds.has(task.id)
  ) {
    const endedAt = current.run.endedAt ?? current.run.startedAt;
    return [
      {
        ...fields,
        kind: current.stage.state === "failed" ? "failed-task" : "stopped-task",
        id: `${current.stage.state}-task:${task.id}:${current.run.id}`,
        taskId: task.id,
        stageName: current.stage.stage.name,
        since: endedAt,
        ended: true,
        endedAt,
      },
    ];
  }
  return [
    {
      ...fields,
      kind: "task",
      id: `task:${task.id}`,
      taskId: task.id,
      state: task.state,
      since: enteredAt(task, stateChanges),
      ended: false,
      endedAt: undefined,
    },
  ];
}

function doneTaskItem(task: ActivityTask): ActivityItem {
  const endedAt = task.endedAt ?? task.createdAt;
  return {
    kind: "task",
    id: `task:${task.id}:done`,
    projectId: task.projectId,
    title: task.title,
    link: taskLink(task.id),
    taskId: task.id,
    state: "done",
    since: endedAt,
    ended: true,
    endedAt,
  };
}

/**
 * An Off-board Task, listed once as its own kind while queued, at a desk or failed (a Stage out of
 * tries, its Decision open), and ended once Done or Dropped, keyed by that state; one waiting for
 * Start isn't listed.
 */
function offBoardTaskItem(offBoardTask: ActivityOffBoardTask): ActivityItem[] {
  const kind = OFF_BOARD_ITEM_KINDS[offBoardTask.kind];
  const { status } = offBoardTask;
  if (kind === undefined || status.state === "ready") return [];
  const ended = status.state === "done" || status.state === "dropped";
  const endedAt = ended ? (status.endedAt ?? offBoardTask.since) : undefined;
  return [
    {
      kind,
      id: ended
        ? `${kind}:${offBoardTask.taskId}:${status.state}`
        : `${kind}:${offBoardTask.taskId}`,
      projectId: offBoardTask.projectId,
      title: offBoardTask.title,
      link: taskLink(offBoardTask.taskId),
      taskId: offBoardTask.taskId,
      state: status.state === "running" ? "in-progress" : status.state,
      stageName: status.state === "failed" ? status.stageName : (offBoardTask.currentStage ?? null),
      tokens: offBoardTask.tokens,
      queued:
        status.state === "queued"
          ? { place: status.place, shortReasons: status.shortReasons }
          : null,
      since: endedAt ?? offBoardTask.since,
      ended,
      endedAt,
    },
  ];
}

function testInstanceItem(instance: ActivityTestInstance): ActivityItem[] {
  if (!LISTED_TEST_INSTANCE_STATES.has(instance.state)) return [];
  const endedAt = ENDED_TEST_INSTANCE_STATES.has(instance.state) ? instance.endedAt : undefined;
  const ended = endedAt !== undefined;
  const since =
    endedAt ??
    (instance.state === "running"
      ? (instance.runningAt ?? instance.launchedAt)
      : instance.launchedAt);
  return [
    {
      kind: "test-instance",
      id: ended ? `test-instance:${instance.id}:${instance.state}` : `test-instance:${instance.id}`,
      projectId: instance.projectId,
      title: instance.targetName,
      link: instance.initiativeId
        ? { kind: "initiative", initiativeId: instance.initiativeId }
        : { kind: "project", projectId: instance.projectId },
      instanceId: instance.id,
      testInstanceKind: instance.kind,
      state: instance.state,
      branch: instance.branch ?? null,
      initiativeId: instance.initiativeId ?? null,
      since,
      ended,
      endedAt,
    },
  ];
}

/**
 * A Project command run, listed only while it runs: it leaves Activity as it ends (spec §2.14,
 * "Items"), so it is never seen ended.
 */
function actionRunItem(run: ActivityActionRun): ActivityItem {
  return {
    kind: "action-run",
    id: `action-run:${run.id}`,
    projectId: run.projectId,
    title: run.actionName,
    link: { kind: "project", projectId: run.projectId },
    runId: run.id,
    actionKey: run.actionKey,
    branch: run.branch,
    startedBy: run.startedBy,
    since: run.startedAt,
    ended: false,
    endedAt: undefined,
  };
}

function ciRunItem(run: ActivityCiRun): ActivityItem {
  const ended = !GOING_CI_RUN_STATUSES.has(run.status);
  const key = `ci-run:${run.projectId}:${run.id}:${run.attempt}`;
  return {
    kind: "ci-run",
    id: ended ? `${key}:ended` : key,
    projectId: run.projectId,
    title: `${run.workflow}: ${run.title}`,
    link: { kind: "url", url: run.url },
    runId: run.id,
    status: run.status,
    url: run.url,
    taskId: run.taskId,
    since: ended ? run.updatedAt : (run.startedAt ?? run.updatedAt),
    ended,
    endedAt: ended ? run.updatedAt : undefined,
  };
}

function environmentCheckItem(check: ActivityEnvironmentCheck): ActivityItem {
  const key = `environment-check:${check.projectId}:${check.startedAt.toISOString()}`;
  const ended = check.finishedAt !== undefined;
  return {
    kind: "environment-check",
    id: ended ? `${key}:ended` : key,
    projectId: check.projectId,
    title: "Environment check",
    link: { kind: "project", projectId: check.projectId },
    state: check.state,
    since: check.finishedAt ?? check.startedAt,
    ended,
    endedAt: check.finishedAt,
  };
}

/** A device leaves the list once Disconnected; it never ends. */
function deviceItem(device: ActivityDevice): ActivityItem[] {
  if (device.state === "disconnected") return [];
  return [
    {
      kind: "connected-device",
      id: `connected-device:${device.id}`,
      projectId: device.projectId,
      title: device.name,
      link: taskLink(device.taskId),
      deviceId: device.id,
      deviceKind: device.kind,
      state: device.state,
      taskId: device.taskId,
      since: device.connectedAt,
      ended: false,
      endedAt: undefined,
    },
  ];
}

/**
 * Only a pull request ready to merge: open, mergeable, its checks passing or none, and read on its
 * last refresh. It leaves the list once merged or closed; it never ends.
 */
function pullRequestItem(pullRequest: ActivityPullRequest): ActivityItem[] {
  if (!isReadyToMerge(pullRequest)) return [];
  return [
    {
      kind: "pull-request",
      id: `pull-request:${pullRequest.id}`,
      projectId: pullRequest.projectId,
      title: pullRequest.title,
      link: { kind: "url", url: pullRequest.url },
      pullRequestId: pullRequest.id,
      number: pullRequest.number,
      url: pullRequest.url,
      taskId: pullRequest.taskId,
      since: pullRequest.checkedAt ?? pullRequest.openedAt,
      ended: false,
      endedAt: undefined,
    },
  ];
}

export function isReadyToMerge(pullRequest: ActivityPullRequest): boolean {
  return (
    pullRequest.state === "open" &&
    pullRequest.mergeable === "yes" &&
    PASSING_CHECKS.has(pullRequest.checks) &&
    !pullRequest.stale
  );
}

/** The Stage whose run started last, with that run; undefined before any Stage ran. */
function currentStageOf(
  stages: readonly ActivityStage[],
): { readonly stage: ActivityStage; readonly run: ActivityStage["runs"][number] } | undefined {
  let current: { stage: ActivityStage; run: ActivityStage["runs"][number] } | undefined;
  for (const stage of stages) {
    const run = stage.runs.at(-1);
    if (run && (!current || run.startedAt.getTime() >= current.run.startedAt.getTime())) {
      current = { stage, run };
    }
  }
  return current;
}

/** When the Task moved into its state: its last change to it, else when it was made. */
function enteredAt(task: ActivityTask, stateChanges: readonly ActivityStateChange[]): Date {
  return stateChanges.findLast(({ to }) => to === task.state)?.at ?? task.createdAt;
}

function taskLink(taskId: string): ActivityLink {
  return { kind: "task", taskId };
}
