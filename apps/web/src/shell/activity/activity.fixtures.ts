import type { ActivityItem, ActivitySession, SubjectActivity } from "@the-office/contracts";

/** The item of one kind. */
type ItemOf<Kind extends ActivityItem["kind"]> = Extract<ActivityItem, { readonly kind: Kind }>;

export const TASK_ID = "3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c";
export const INITIATIVE_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const NOW = new Date("2026-11-22T12:00:00.000Z");

/** One active session of a Task's activity: a Developer working, unless said. */
export function subjectActivity(overrides: Partial<SubjectActivity> = {}): SubjectActivity {
  return {
    id: `task:${TASK_ID}`,
    subject: {
      kind: "task",
      taskId: TASK_ID,
      projectId: "p1",
      title: "Add a filter",
      initiativeId: null,
    },
    link: { kind: "task", taskId: TASK_ID },
    since: minutesAgo(18),
    sessions: [
      {
        threadId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        person: { kind: "person", roleKey: "developer" },
        sessionKind: "stage",
        stageName: "Implement",
        state: "working",
        waitingOn: null,
        since: minutesAgo(18),
      },
    ],
    ...overrides,
  };
}

export function environmentCheckItem(
  overrides: Partial<ItemOf<"environment-check">> = {},
): ItemOf<"environment-check"> {
  return {
    kind: "environment-check",
    id: "environment-check:p1:1",
    projectId: "p1",
    title: "Environment check",
    since: minutesAgo(130),
    link: { kind: "project", projectId: "p1" },
    state: "running",
    ...overrides,
  };
}

export function ciRunItem(overrides: Partial<ItemOf<"ci-run">> = {}): ItemOf<"ci-run"> {
  return {
    kind: "ci-run",
    id: "ci-run:p1:118",
    projectId: "p1",
    title: "CI run 118 · Add a filter",
    since: minutesAgo(3),
    link: { kind: "url", url: "https://github.com/acme/app/actions/runs/118" },
    runId: 118,
    status: "running",
    url: "https://github.com/acme/app/actions/runs/118",
    taskId: null,
    ...overrides,
  };
}

export function testInstanceItem(
  overrides: Partial<ItemOf<"test-instance">> = {},
): ItemOf<"test-instance"> {
  return {
    kind: "test-instance",
    id: "test-instance:1:running",
    projectId: "p1",
    title: "Web preview",
    since: minutesAgo(5),
    link: { kind: "project", projectId: "p1" },
    instanceId: "5d0c8a2e-3f6b-4a8e-9c1d-7b2e4f6a8c10",
    testInstanceKind: "hosted",
    state: "running",
    branch: "office/add-a-filter",
    initiativeId: null,
    ...overrides,
  };
}

export function actionRunItem(overrides: Partial<ItemOf<"action-run">> = {}): ItemOf<"action-run"> {
  return {
    kind: "action-run",
    id: "action-run:1",
    projectId: "p1",
    title: "Build web on main",
    since: minutesAgo(3),
    link: { kind: "project", projectId: "p1" },
    runId: "6e1d9b3f-4a7c-4b8d-9e0f-8c2d5f7b9d21",
    actionKey: "build-web",
    branch: "main",
    startedBy: "Ann Lee",
    ...overrides,
  };
}

export function failedTaskItem(
  overrides: Partial<ItemOf<"failed-task">> = {},
): ItemOf<"failed-task"> {
  return {
    kind: "failed-task",
    id: "failed-task:run-1",
    projectId: "p1",
    title: "Fix the header",
    since: minutesAgo(60 * 50),
    link: { kind: "task", taskId: TASK_ID },
    taskId: TASK_ID,
    stageName: "Tests",
    ...overrides,
  };
}

export const OFF_BOARD_TASK_ID = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";

/** An Off-board Task's item, Onboard's unless the kind is given, at its Stage. */
export function offBoardTaskItem(
  overrides: Partial<ItemOf<"onboarding">> | Partial<ItemOf<"run-environment-set-up">> = {},
): ItemOf<"onboarding"> | ItemOf<"run-environment-set-up"> {
  const fields = {
    id: `onboarding:${OFF_BOARD_TASK_ID}`,
    projectId: "p1",
    title: "Onboard",
    since: minutesAgo(8),
    link: { kind: "task", taskId: OFF_BOARD_TASK_ID },
    taskId: OFF_BOARD_TASK_ID,
    state: "in-progress",
    stageName: "Onboard",
    tokens: 212_000,
    queued: null,
  } as const;
  return overrides.kind === "run-environment-set-up"
    ? { ...fields, ...overrides, kind: "run-environment-set-up" }
    : { ...fields, ...overrides, kind: "onboarding" };
}

export function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

/** One active session: a Developer working at Implement, unless said. */
export function sessionOf(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    threadId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    person: { kind: "person", roleKey: "developer" },
    sessionKind: "stage",
    stageName: "Implement",
    state: "working",
    waitingOn: null,
    since: minutesAgo(18),
    ...overrides,
  };
}
