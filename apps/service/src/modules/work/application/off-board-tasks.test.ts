import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ONBOARD_PROJECT_ACTION,
  offBoardTaskStartSchema,
  projectOffBoardTasksSchema,
  type OffBoardTaskStart,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../engine/index.js";
import { ownProjectsQueue } from "../adapters/postgres/postgres-queue-repository.fixtures.js";
import type { OffBoardTaskStart as Start } from "../domain/off-board-task.js";
import { TaskCreated, TaskDiscarded } from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import { ANN_LEE } from "../domain/work.fixtures.js";
import {
  KnownPeopleForTests,
  ProjectWorktreesForTests,
  SessionPeopleForTests,
} from "../ports/work-ports.fixtures.js";
import { TaskRepository } from "../ports/task-repository.js";
import { QueueRepository } from "../ports/queue-repository.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { OffBoardTasks } from "./off-board-tasks.js";
import { OnboardingService } from "./onboarding-service.js";
import { StartService } from "./start-service.js";
import { TaskService } from "./task-service.js";

const ONBOARDS_PROJECTS = "onboards-projects";

let officeData: string;
let work: WorkApplication;
/** The Projects whose Tasks this file's queue sees: the running test's alone. */
const ownProjects: string[] = [];

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-off-board-tasks-"));
  work = await startWorkApplication(officeData, [ownProjectsQueue(() => ownProjects)]);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  const people = work.app.get(KnownPeopleForTests);
  people.taskLimits.clear();
  people.hold(ONBOARDS_PROJECTS, "devops");
  work.app.get(ProjectWorktreesForTests).failure = undefined;
  ownProjects.length = 0;
});

function aProject(): string {
  const projectId = `project-${randomUUID()}`;
  ownProjects.push(projectId);
  return projectId;
}

const offBoardTasks = () => work.app.get(OffBoardTasks);

function taskIdOf(start: Start): string {
  if (start.outcome === "refused") throw new Error(start.reasons.join(" "));
  return start.offBoardTask.taskId;
}

describe("OffBoardTasks.start", () => {
  it("makes the Onboard Task and starts it at once, in a worktree of its own", async () => {
    const projectId = aProject();

    const start = await offBoardTasks().start("onboard", projectId, ANN_LEE);

    expect(start).toMatchObject({
      outcome: "started",
      offBoardTask: {
        projectId,
        title: "Onboard",
        kind: "onboard",
        status: { state: "running" },
        stages: ["Onboard", "Resolve", "Verify", "Test after Resolve", "Publish"],
      },
    });
    const task = await work.app.get(TaskService).read(taskIdOf(start));
    expect(task).toMatchObject({ state: "in-progress", madeFor: "onboard" });
    expect(work.app.get(ProjectWorktreesForTests).opened).toContain(`${projectId}/${task.id}`);
  });

  it("answers the one in flight while one of its kind is open, and makes another of the other kind", async () => {
    const projectId = aProject();
    const first = await offBoardTasks().start("onboard", projectId, ANN_LEE);

    const [again, atOnce] = await Promise.all([
      offBoardTasks().start("onboard", projectId, ANN_LEE),
      offBoardTasks().start("onboard", projectId, ANN_LEE),
    ]);
    const setUp = await offBoardTasks().start("run-environment-setup", projectId, ANN_LEE);

    expect(again).toMatchObject({
      outcome: "in-flight",
      offBoardTask: { taskId: taskIdOf(first) },
    });
    expect(atOnce).toMatchObject({
      outcome: "in-flight",
      offBoardTask: { taskId: taskIdOf(first) },
    });
    expect(setUp).toMatchObject({
      outcome: "started",
      offBoardTask: { kind: "run-environment-setup", title: "Set up the run environment" },
    });
    expect(await work.app.get(TaskRepository).madeFor("onboard", projectId)).toHaveLength(1);
  });

  it("queues it with its place when the limits leave no room", async () => {
    const people = work.app.get(KnownPeopleForTests);
    people.taskLimits.set("devops", 1);
    const busy = aProject();
    taskIdOf(await offBoardTasks().start("onboard", busy, ANN_LEE));
    const projectId = aProject();

    const start = await offBoardTasks().start("onboard", projectId, ANN_LEE);

    expect(start).toMatchObject({
      outcome: "started",
      offBoardTask: { status: { state: "queued", place: 1 } },
    });
    const queued = (await work.app.get(QueueRepository).list()).map(({ taskId }) => taskId);
    expect(queued).toContain(taskIdOf(start));
    expect((await work.app.get(TaskService).read(taskIdOf(start))).state).toBe("ready");
  });

  it("makes nothing when Start refuses it, with every reason", async () => {
    work.app.get(KnownPeopleForTests).hold(ONBOARDS_PROJECTS, undefined);
    const projectId = aProject();

    const start = await offBoardTasks().start("onboard", projectId, ANN_LEE);

    expect(start).toEqual({
      outcome: "refused",
      reasons: [expect.stringContaining("Nobody holds")],
    });
    expect(await work.app.get(TaskRepository).madeFor("onboard", projectId)).toEqual([]);
  });

  it("takes the Task and its worktree away again when Start refuses it after it was made, and says so", async () => {
    const projectId = aProject();
    vi.spyOn(work.app.get(StartService), "start").mockRejectedValueOnce(
      new TaskRefused(["The fire alarm is on."]),
    );
    work.published.length = 0;

    const start = await offBoardTasks().start("onboard", projectId, ANN_LEE);

    expect(start).toEqual({ outcome: "refused", reasons: ["The fire alarm is on."] });
    expect(await work.app.get(TaskRepository).madeFor("onboard", projectId)).toEqual([]);
    const created = work.published.find((event) => event instanceof TaskCreated);
    if (!(created instanceof TaskCreated)) throw new Error("No TaskCreated was told.");
    const discarded = work.published.at(-1);
    expect(discarded).toBeInstanceOf(TaskDiscarded);
    expect(discarded).toMatchObject({ taskId: created.task.id, projectId });
    expect(work.app.get(ProjectWorktreesForTests).opened).not.toContain(
      `${projectId}/${created.task.id}`,
    );
  });

  it("makes nothing when the worktree can't be made", async () => {
    work.app.get(ProjectWorktreesForTests).failure = new Error("The disk is full.");
    const projectId = aProject();

    const start = await offBoardTasks().start("run-environment-setup", projectId, ANN_LEE);

    expect(start).toEqual({
      outcome: "refused",
      reasons: ["The set-up Task's worktree couldn't be made: The disk is full."],
    });
    expect(await work.app.get(TaskRepository).madeFor("run-environment-setup", projectId)).toEqual(
      [],
    );
  });
});

/** As Pipelines moves a started Task to its end. */
async function end(taskId: string, to: "done" | "dropped"): Promise<void> {
  await work.app.get(TaskService).changeState(taskId, to);
}

describe("Onboard again", () => {
  it("makes a new Onboard Task once the latest is Done or Dropped, reading onboarding from it", async () => {
    const projectId = aProject();
    const onboarding = work.app.get(OnboardingService);
    const first = taskIdOf(await onboarding.onboard(projectId, ANN_LEE));
    await end(first, "done");
    expect(await onboarding.onboardingOf(projectId)).toMatchObject({ state: "onboarded" });

    const second = taskIdOf(await onboarding.onboard(projectId, ANN_LEE));
    expect(second).not.toBe(first);
    expect(await onboarding.onboardingOf(projectId)).toEqual({
      projectId,
      taskId: second,
      state: "onboarding",
    });
    expect((await onboarding.list()).filter((each) => each.projectId === projectId)).toEqual([
      { projectId, taskId: second, state: "onboarding" },
    ]);

    await end(second, "dropped");
    expect(await onboarding.onboardingOf(projectId)).toBeUndefined();
    const third = taskIdOf(await onboarding.onboard(projectId, ANN_LEE));

    const response = await sendJson(work, "GET", `/projects/${projectId}/off-board-tasks`);
    expect(response.status).toBe(200);
    const read = projectOffBoardTasksSchema.parse(await response.json());
    expect(read.onboard).toMatchObject({ taskId: third, status: { state: "running" } });
    expect(read.onboardHistory.map(({ taskId, status }) => [taskId, status.state])).toEqual([
      [second, "dropped"],
      [first, "done"],
    ]);
    expect(read.runEnvironmentSetUp).toBeNull();
  });
});

async function onboardOverHttp(projectId: string): Promise<OffBoardTaskStart> {
  const response = await sendJson(work, "POST", `/projects/${projectId}/onboard`);
  expect(response.status).toBe(200);
  return offBoardTaskStartSchema.parse(await response.json());
}

describe("POST /projects/:id/onboard", () => {
  it("starts the Onboard Task, then answers it in flight", async () => {
    const projectId = aProject();

    const first = await onboardOverHttp(projectId);
    const second = await onboardOverHttp(projectId);

    expect(first).toMatchObject({
      outcome: "started",
      offBoardTask: { kind: "onboard", status: { state: "running" } },
    });
    expect(second.outcome).toBe("in-flight");
  });

  it("answers a refusal, making nothing", async () => {
    work.app.get(KnownPeopleForTests).hold(ONBOARDS_PROJECTS, undefined);
    const projectId = aProject();

    expect((await onboardOverHttp(projectId)).outcome).toBe("refused");
    expect(await work.app.get(TaskRepository).madeFor("onboard", projectId)).toEqual([]);
  });
});

describe("the onboard_project Office action", () => {
  it("starts the Onboard Task through its tool, as the route does, then answers it open", async () => {
    const projectId = aProject();
    work.app.get(SessionPeopleForTests).people.set("devops-session", "devops");
    const [tool] = work.app
      .get(OfficeToolRegistry)
      .named([ONBOARD_PROJECT_ACTION.name], RUN_EVERY_CALL);
    if (!tool) throw new Error("No Office tool onboard_project.");

    const first = await tool.run({ projectId }, anOfficeToolCall("devops-session"));
    const second = await tool.run({ projectId }, anOfficeToolCall("devops-session"));

    expect(first).toMatchObject({
      isError: false,
      text: expect.stringMatching(/is (started|queued)/),
    });
    expect(second).toMatchObject({ isError: false, text: expect.stringContaining("already open") });
    expect(tool.authority).toMatchObject({ group: "projectSettings" });
    expect(tool.authority?.subject({ projectId })).toEqual({ kind: "project", id: projectId });
  });

  it("words a refusal to the Agent, making nothing", async () => {
    work.app.get(KnownPeopleForTests).hold(ONBOARDS_PROJECTS, undefined);
    const projectId = aProject();
    work.app.get(SessionPeopleForTests).people.set("devops-session", "devops");
    const [tool] = work.app
      .get(OfficeToolRegistry)
      .named([ONBOARD_PROJECT_ACTION.name], RUN_EVERY_CALL);

    const result = await tool?.run({ projectId }, anOfficeToolCall("devops-session"));

    expect(result).toMatchObject({ isError: false, text: expect.stringContaining("was refused") });
    expect(await work.app.get(TaskRepository).madeFor("onboard", projectId)).toEqual([]);
  });

  it("drafts a generic Proposal of the Project, and applying it onboards as the user", async () => {
    const projectId = aProject();
    const registry = work.app.get(OfficeToolRegistry);

    const drafted = await registry.draft(ONBOARD_PROJECT_ACTION.name, { projectId });
    await registry.applyFor(
      ONBOARD_PROJECT_ACTION.name,
      { projectId },
      {
        user: { userId: "ann", name: "Ann Lee" },
        proposedBy: "devops",
      },
    );

    expect(drafted).toMatchObject({ subject: { kind: "project", id: projectId }, fields: [] });
    expect(await work.app.get(TaskRepository).madeFor("onboard", projectId)).toHaveLength(1);
  });
});
