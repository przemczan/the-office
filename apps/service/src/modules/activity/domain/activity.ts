/** The Task states at a desk, which Activity lists as running. */
const AT_A_DESK: ReadonlySet<string> = new Set(["in-progress", "waiting-on-you", "paused"]);
const LISTED_TEST_INSTANCE_STATES: ReadonlySet<string> = new Set(["building", "running"]);
const GOING_CI_RUN_STATUSES: ReadonlySet<string> = new Set(["queued", "waiting", "running"]);

/** A Task as Activity reads it, from Work. */
export interface ActivityTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly state: string;
  /** The Initiative it belongs to, if any. */
  readonly initiativeId: string | undefined;
  /** What The Office made it for, if anything: an Off-board Task's is listed as its own kind. */
  readonly madeFor?: string | undefined;
}

/** A started Task with its own Stages, oldest first. */
export interface StartedActivityTask {
  readonly task: ActivityTask;
  readonly stages: readonly ActivityStage[];
}

/** One of a Task's Stages, with where it stands and its runs, oldest first, from Pipelines. */
export interface ActivityStage {
  readonly stage: { readonly name: string; readonly kind: string };
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
    | { readonly state: "done" | "dropped" };
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

/** What an active session is about, as Conversations reads it. */
export type ActivitySessionSubject =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | {
      readonly kind: "chat";
      readonly threadId: string;
      readonly roleKey: string;
      readonly title: string | undefined;
    };

/** One active session of a person, as Conversations reads it (spec §2.14, "Sessions"). */
export interface ActivityThreadSession {
  readonly threadId: string;
  readonly roleKey: string;
  readonly subject: ActivitySessionSubject;
  readonly sessionKind: "stage" | "consultation" | "thread" | "chat";
  readonly state: "working" | "waiting";
  readonly waitingOn:
    | { readonly kind: "decision" | "consultant" | "reply"; readonly question: string | undefined }
    | undefined;
  readonly since: Date;
}

/** Everything Activity gathers from the modules that own it, for one read. */
export interface ActivityParts {
  /** The user's active sessions of people. */
  readonly threadSessions: readonly ActivityThreadSession[];
  /** The Tasks at a desk with their Stages, which hold The Office's own sessions and stalls. */
  readonly started: readonly StartedActivityTask[];
  /** The Tasks the sessions are on, that aren't among `started`. */
  readonly otherTasks: readonly ActivityTask[];
  readonly initiativeTitles: ReadonlyMap<string, string>;
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
}

export type ActivityLink =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "chat"; readonly roleKey: string; readonly threadId: string }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "url"; readonly url: string };

interface ItemFields {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly since: Date;
  readonly link: ActivityLink;
}

/** One piece of other running work: listed only while it runs or stalls (spec §2.14). */
export type ActivityItem = ItemFields &
  (
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
  );

/** One active session: a person's, or The Office's own (a Gate, a Stage with no Agent). */
export interface ActivitySession {
  /** Undefined for The Office's own sessions. */
  readonly threadId: string | undefined;
  /** The person's Role key; undefined for The Office. */
  readonly roleKey: string | undefined;
  readonly sessionKind: ActivityThreadSession["sessionKind"] | "gate";
  readonly stageName: string | undefined;
  readonly state: "working" | "waiting";
  readonly waitingOn:
    | {
        readonly kind: "decision" | "consultant" | "gate" | "reply";
        readonly question: string | undefined;
      }
    | undefined;
  readonly since: Date;
}

export type ActivitySubject =
  | {
      readonly kind: "task";
      readonly taskId: string;
      readonly projectId: string;
      readonly title: string;
      readonly initiativeId: string | undefined;
    }
  | { readonly kind: "initiative"; readonly initiativeId: string; readonly title: string }
  | {
      readonly kind: "chat";
      readonly threadId: string;
      readonly roleKey: string;
      readonly title: string;
    };

/** Every active session on one Task, Initiative or chat. */
export interface SubjectActivity {
  readonly id: string;
  readonly subject: ActivitySubject;
  readonly link: ActivityLink;
  /** The earliest of its sessions'. */
  readonly since: Date;
  readonly sessions: readonly ActivitySession[];
}

export interface Activity {
  readonly activities: readonly SubjectActivity[];
  readonly otherWork: readonly ActivityItem[];
  /** What is listed: the activities and the items of other work. */
  readonly count: number;
}

/** What a chat with no title yet is called. */
const UNTITLED_CHAT = "New chat";

/**
 * The user's Activity: the active sessions grouped one activity per Task, Initiative and chat, and
 * the other running work; each the newest first.
 */
export function activityOf(parts: ActivityParts): Activity {
  const otherWork = itemsOf(parts).toSorted(newestFirst);
  const activities = activitiesOf(parts).toSorted(newestFirst);
  return { activities, otherWork, count: activities.length + otherWork.length };
}

function newestFirst(
  first: { readonly since: Date; readonly id: string },
  second: { readonly since: Date; readonly id: string },
): number {
  return second.since.getTime() - first.since.getTime() || first.id.localeCompare(second.id);
}

function itemsOf(parts: ActivityParts): ActivityItem[] {
  const offBoard = new Set(parts.offBoardTasks.map(({ taskId }) => taskId));
  const onBoard = (task: ActivityTask) => !offBoard.has(task.id) && !isOffBoard(task);
  return [
    ...parts.started
      .filter(({ task }) => onBoard(task))
      .flatMap((started) => stalledTaskItem(started, parts.openDecisionTaskIds)),
    ...parts.offBoardTasks.flatMap(offBoardTaskItem),
    ...parts.testInstances.flatMap(testInstanceItem),
    ...parts.actionRuns.map(actionRunItem),
    ...parts.ciRuns.flatMap(ciRunItem),
    ...parts.environmentChecks.flatMap(environmentCheckItem),
    ...parts.devices.flatMap(deviceItem),
  ];
}

function activitiesOf(parts: ActivityParts): SubjectActivity[] {
  const offBoardIds = new Set(parts.offBoardTasks.map(({ taskId }) => taskId));
  const tasks = new Map(
    [...parts.started.map(({ task }) => task), ...parts.otherTasks].map((task) => [task.id, task]),
  );
  const sessionsBySubject = new Map<string, ActivitySession[]>();
  const subjects = new Map<string, ActivitySubject>();
  const add = (subject: ActivitySubject | undefined, session: ActivitySession): void => {
    if (!subject) return;
    const id = subjectIdOf(subject);
    subjects.set(id, subject);
    sessionsBySubject.set(id, [...(sessionsBySubject.get(id) ?? []), session]);
  };

  for (const thread of parts.threadSessions) {
    const stageName = stageNameOf(thread, parts.started);
    add(subjectOf(thread.subject, tasks, offBoardIds, parts.initiativeTitles), {
      threadId: thread.threadId,
      roleKey: thread.roleKey,
      sessionKind: thread.sessionKind,
      stageName,
      state: thread.state,
      waitingOn: thread.waitingOn,
      since: thread.since,
    });
  }
  for (const started of parts.started) {
    if (offBoardIds.has(started.task.id) || isOffBoard(started.task)) continue;
    const session = officeSessionOf(started.stages);
    if (session) {
      add(
        subjectOf(
          { kind: "task", taskId: started.task.id },
          tasks,
          offBoardIds,
          parts.initiativeTitles,
        ),
        session,
      );
    }
  }

  return [...sessionsBySubject].flatMap(([id, sessions]) => {
    const subject = subjects.get(id);
    if (!subject) return [];
    const ordered = sessions.toSorted(
      (first, second) => first.since.getTime() - second.since.getTime(),
    );
    return [
      {
        id,
        subject,
        link: linkOf(subject),
        since: ordered[0]?.since ?? new Date(0),
        sessions: ordered,
      },
    ];
  });
}

function subjectOf(
  subject: ActivitySessionSubject,
  tasks: ReadonlyMap<string, ActivityTask>,
  offBoardIds: ReadonlySet<string>,
  initiativeTitles: ReadonlyMap<string, string>,
): ActivitySubject | undefined {
  switch (subject.kind) {
    case "task": {
      const task = tasks.get(subject.taskId);
      if (!task || offBoardIds.has(task.id) || isOffBoard(task)) return undefined;
      return {
        kind: "task",
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        initiativeId: task.initiativeId,
      };
    }
    case "initiative": {
      const title = initiativeTitles.get(subject.initiativeId);
      return title === undefined
        ? undefined
        : { kind: "initiative", initiativeId: subject.initiativeId, title };
    }
    case "chat":
      return {
        kind: "chat",
        threadId: subject.threadId,
        roleKey: subject.roleKey,
        title: subject.title ?? UNTITLED_CHAT,
      };
  }
}

function subjectIdOf(subject: ActivitySubject): string {
  switch (subject.kind) {
    case "task":
      return `task:${subject.taskId}`;
    case "initiative":
      return `initiative:${subject.initiativeId}`;
    case "chat":
      return `chat:${subject.threadId}`;
  }
}

function linkOf(subject: ActivitySubject): ActivityLink {
  switch (subject.kind) {
    case "task":
      return taskLink(subject.taskId);
    case "initiative":
      return { kind: "initiative", initiativeId: subject.initiativeId };
    case "chat":
      return { kind: "chat", roleKey: subject.roleKey, threadId: subject.threadId };
  }
}

/** The Stage a Stage Thread works: its Task's current Stage, while that is running or waiting. */
function stageNameOf(
  thread: ActivityThreadSession,
  started: readonly StartedActivityTask[],
): string | undefined {
  if (thread.sessionKind !== "stage" || thread.subject.kind !== "task") return undefined;
  const { taskId } = thread.subject;
  const stages = started.find(({ task }) => task.id === taskId)?.stages ?? [];
  return currentStageOf(stages)?.stage.stage.name;
}

/**
 * The Task's current Stage as The Office's own session: a Gate waiting on the user, or a Script
 * or Publish Stage running, which no Agent works.
 */
function officeSessionOf(stages: readonly ActivityStage[]): ActivitySession | undefined {
  const current = currentStageOf(stages);
  if (!current) return undefined;
  const { stage, run } = current;
  const base = {
    threadId: undefined,
    roleKey: undefined,
    stageName: stage.stage.name,
    since: run.startedAt,
  };
  if (stage.stage.kind === "gate" && stage.state === "waiting-on-you") {
    return {
      ...base,
      sessionKind: "gate",
      state: "waiting",
      waitingOn: { kind: "gate", question: undefined },
    };
  }
  if (
    (stage.stage.kind === "script" || stage.stage.kind === "publish") &&
    stage.state === "running"
  ) {
    return { ...base, sessionKind: "stage", state: "working", waitingOn: undefined };
  }
  return undefined;
}

/**
 * A started Task, never an Off-board Task, is `failed-task` or `stopped-task` while its current
 * Stage, the one run last, is failed or stopped and no Decision is open on it, keyed by that run so
 * a later one shows again.
 */
function stalledTaskItem(
  { task, stages }: StartedActivityTask,
  openDecisionTaskIds: ReadonlySet<string>,
): ActivityItem[] {
  if (!AT_A_DESK.has(task.state)) return [];
  const current = currentStageOf(stages);
  if (
    !current ||
    (current.stage.state !== "failed" && current.stage.state !== "stopped") ||
    openDecisionTaskIds.has(task.id)
  ) {
    return [];
  }
  return [
    {
      kind: current.stage.state === "failed" ? "failed-task" : "stopped-task",
      id: `${current.stage.state}-task:${task.id}:${current.run.id}`,
      projectId: task.projectId,
      title: task.title,
      link: taskLink(task.id),
      taskId: task.id,
      stageName: current.stage.stage.name,
      since: current.run.endedAt ?? current.run.startedAt,
    },
  ];
}

/**
 * An Off-board Task, listed once as its own kind while queued, at a desk or failed (a Stage out of
 * tries, its Decision open); one waiting for Start, Done or Dropped isn't listed.
 */
function offBoardTaskItem(offBoardTask: ActivityOffBoardTask): ActivityItem[] {
  const kind = OFF_BOARD_ITEM_KINDS[offBoardTask.kind];
  const { status } = offBoardTask;
  if (
    kind === undefined ||
    status.state === "ready" ||
    status.state === "done" ||
    status.state === "dropped"
  ) {
    return [];
  }
  return [
    {
      kind,
      id: `${kind}:${offBoardTask.taskId}`,
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
      since: offBoardTask.since,
    },
  ];
}

function testInstanceItem(instance: ActivityTestInstance): ActivityItem[] {
  if (!LISTED_TEST_INSTANCE_STATES.has(instance.state)) return [];
  return [
    {
      kind: "test-instance",
      id: `test-instance:${instance.id}`,
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
      since:
        instance.state === "running"
          ? (instance.runningAt ?? instance.launchedAt)
          : instance.launchedAt,
    },
  ];
}

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
  };
}

function ciRunItem(run: ActivityCiRun): ActivityItem[] {
  if (!GOING_CI_RUN_STATUSES.has(run.status)) return [];
  return [
    {
      kind: "ci-run",
      id: `ci-run:${run.projectId}:${run.id}:${run.attempt}`,
      projectId: run.projectId,
      title: `${run.workflow}: ${run.title}`,
      link: { kind: "url", url: run.url },
      runId: run.id,
      status: run.status,
      url: run.url,
      taskId: run.taskId,
      since: run.startedAt ?? run.updatedAt,
    },
  ];
}

/** Only a check running now: one that finished isn't listed. */
function environmentCheckItem(check: ActivityEnvironmentCheck): ActivityItem[] {
  if (check.finishedAt !== undefined) return [];
  return [
    {
      kind: "environment-check",
      id: `environment-check:${check.projectId}:${check.startedAt.toISOString()}`,
      projectId: check.projectId,
      title: "Environment check",
      link: { kind: "project", projectId: check.projectId },
      state: check.state,
      since: check.startedAt,
    },
  ];
}

/** A device leaves the list once Disconnected. */
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
    },
  ];
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

function taskLink(taskId: string): ActivityLink {
  return { kind: "task", taskId };
}
