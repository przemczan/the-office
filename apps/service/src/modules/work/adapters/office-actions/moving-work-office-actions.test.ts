import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHOOSE_TASK_ENGINE_ACTION,
  CHOOSE_TASK_PIPELINE_ACTION,
  CONFIRM_TASK_DEFINITION_OF_DONE_ACTION,
  CONFIRM_TASK_PLAN_ACTION,
  DELETE_VIEW_ACTION,
  MAKE_A_PLAN_ACTION,
  MARK_TASK_READY_ACTION,
  MOVE_TASK_ACTION,
  MOVE_TO_TOP_OF_QUEUE_ACTION,
  MOVE_UP_IN_QUEUE_ACTION,
  PAUSE_TASK_ACTION,
  PLACE_TASK_ACTION,
  PLAN_WITH_ACTION,
  RESOLVE_CONFLICTS_ACTION,
  RESUME_TASK_ACTION,
  SAVE_VIEW_ACTION,
  START_TASK_ACTION,
  STOP_TASK_ACTION,
  TAKE_OUT_OF_QUEUE_ACTION,
  savedViewListSchema,
  savedViewSchema,
  startAnswerSchema,
  taskSchema,
  workRefusalSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { TaskService } from "../../application/task-service.js";
import { SessionPeopleForTests, UNKNOWN_PROJECT } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { tasksHttp } from "../../tasks.controller.fixtures.js";

const MOVING_WORK_ACTIONS = [
  MARK_TASK_READY_ACTION,
  CONFIRM_TASK_PLAN_ACTION,
  CONFIRM_TASK_DEFINITION_OF_DONE_ACTION,
  CHOOSE_TASK_PIPELINE_ACTION,
  CHOOSE_TASK_ENGINE_ACTION,
  PLACE_TASK_ACTION,
  MAKE_A_PLAN_ACTION,
  PLAN_WITH_ACTION,
  START_TASK_ACTION,
  PAUSE_TASK_ACTION,
  STOP_TASK_ACTION,
  RESUME_TASK_ACTION,
  MOVE_TASK_ACTION,
  TAKE_OUT_OF_QUEUE_ACTION,
  MOVE_UP_IN_QUEUE_ACTION,
  MOVE_TO_TOP_OF_QUEUE_ACTION,
  RESOLVE_CONFLICTS_ACTION,
  SAVE_VIEW_ACTION,
  DELETE_VIEW_ACTION,
];

const SESSION = "mover-session";
const ASKED_BY = { userId: "user-ann", name: "Ann Lee" };
const ALLOWED_BY = { userId: "user-ben", name: "Ben Ito" };

let officeData: string;
let work: WorkApplication;
let projectId: string;
const { create, readyTask, proposedTask } = tasksHttp(() => ({
  work,
  projectId,
}));

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-moving-work-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    ownProjectsQueue(() => [projectId]),
  ]);
  work.app.get(SessionPeopleForTests).people.set(SESSION, "planner");
  work.app.get(SessionPeopleForTests).askedBy.set(SESSION, ASKED_BY);
});

afterEach(async () => {
  await work.app.close();
});

function callTool(
  name: string,
  input: Record<string, unknown>,
  allowedBy?: { userId: string; name: string },
) {
  const [tool] = work.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, { ...anOfficeToolCall(SESSION), ...(allowedBy && { allowedBy }) });
}

describe("the derived Office tools of Moving work", () => {
  it("are ruled by the Moving work group, each with the declared input", () => {
    const registry = work.app.get(OfficeToolRegistry);

    for (const action of MOVING_WORK_ACTIONS) {
      const [tool] = registry.named([action.name], RUN_EVERY_CALL);
      expect(tool).toMatchObject({
        description: action.description,
        authority: { group: "movingWork" },
        input: action.input,
      });
    }
  });
});

describe("start_task", () => {
  it("starts a Ready Task through the route and the tool alike, answering the Agent in words", async () => {
    const first = await readyTask();
    const second = await readyTask();

    const route = await sendJson(work, "POST", `/tasks/${first.id}/start`, {});
    const tool = await callTool(START_TASK_ACTION.name, { taskId: second.id });

    expect(route.status).toBe(200);
    expect(startAnswerSchema.parse(await route.json()).task.state).toBe("in-progress");
    expect(tool.isError).toBe(false);
    expect(tool.text).toContain("is started, in In progress");
  });

  it("is recorded in the person's name, with the user who asked and the one who allowed it", async () => {
    const task = await readyTask();

    await callTool(START_TASK_ACTION.name, { taskId: task.id }, ALLOWED_BY);

    const changes = await work.app.get(TaskService).stateChangesOf(task.id);
    expect(changes.at(-1)).toMatchObject({
      to: "in-progress",
      by: { kind: "person", roleKey: "planner", askedBy: ASKED_BY, allowedBy: ALLOWED_BY },
    });
  });

  it("refuses a Task that isn't Ready in the same words to the user and the Agent", async () => {
    const task = await create();

    const route = await sendJson(work, "POST", `/tasks/${task.id}/start`, {});
    expect(route.status).toBe(422);
    const reasons = workRefusalSchema.parse(await route.json()).reasons;
    const tool = await callTool(START_TASK_ACTION.name, { taskId: task.id });

    expect(tool).toEqual({ text: reasons.join(" "), isError: true });
  });
});

describe("the Task's holds and moves", () => {
  it("Pause, Stop and Resume answer the same Task through the route and the tool", async () => {
    const task = await readyTask();
    await sendJson(work, "POST", `/tasks/${task.id}/start`, {});

    const paused = await callTool(PAUSE_TASK_ACTION.name, { taskId: task.id });
    const resumed = await sendJson(work, "POST", `/tasks/${task.id}/resume`);
    const stopped = await sendJson(work, "POST", `/tasks/${task.id}/stop`);
    const resumedByTool = await callTool(RESUME_TASK_ACTION.name, { taskId: task.id });

    expect(paused.text).toContain("is paused");
    expect(resumed.status).toBe(200);
    expect(taskSchema.parse(await stopped.json()).state).toBe("paused");
    expect(resumedByTool.isError).toBe(false);
  });

  it("Move refuses an unknown Project in the same words to the user and the Agent", async () => {
    const task = await create();

    const route = await sendJson(work, "POST", `/tasks/${task.id}/move`, {
      projectId: UNKNOWN_PROJECT,
    });
    const reasons = workRefusalSchema.parse(await route.json()).reasons;
    const tool = await callTool(MOVE_TASK_ACTION.name, {
      taskId: task.id,
      projectId: UNKNOWN_PROJECT,
    });

    expect(route.status).toBe(422);
    expect(tool).toEqual({ text: reasons.join(" "), isError: true });
  });

  it("Mark Ready refuses an unconfirmed Task in the same words to the user and the Agent", async () => {
    const task = await create();

    const route = await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    const reasons = workRefusalSchema.parse(await route.json()).reasons;
    const tool = await callTool(MARK_TASK_READY_ACTION.name, { taskId: task.id });

    expect(route.status).toBe(422);
    expect(tool).toEqual({ text: reasons.join(" "), isError: true });
  });

  it("Mark Ready with the Plan and the Definition of Done confirmed as they stand, by the tool", async () => {
    const task = await create();
    await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
    await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Mine."],
    });
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "quick-fix" });

    const tool = await callTool(MARK_TASK_READY_ACTION.name, {
      taskId: task.id,
      confirmPlanAndDefinitionOfDone: true,
    });

    expect(tool).toEqual({ text: `"Fix the login redirect" is Ready now.`, isError: false });
    expect(await work.app.get(TaskService).read(task.id)).toMatchObject({
      state: "ready",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
    });
  });

  it("Choose Pipeline sets the Task's Pipeline through the route and the tool alike", async () => {
    const task = await proposedTask();
    const other = await proposedTask();

    const route = await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, {
      pipelineId: "quick-fix",
    });
    const tool = await callTool(CHOOSE_TASK_PIPELINE_ACTION.name, {
      taskId: other.id,
      pipelineId: "quick-fix",
    });

    expect(taskSchema.parse(await route.json()).pipelineId).toBe("quick-fix");
    expect(tool.isError).toBe(false);
    expect((await work.app.get(TaskService).read(other.id)).pipelineId).toBe("quick-fix");
  });

  it("Choose engine refuses an engine not listed in the same words to the user and the Agent", async () => {
    const task = await create();

    const route = await sendJson(work, "PUT", `/tasks/${task.id}/engine`, { engineId: "unlisted" });
    const reasons = workRefusalSchema.parse(await route.json()).reasons;
    const tool = await callTool(CHOOSE_TASK_ENGINE_ACTION.name, {
      taskId: task.id,
      engineId: "unlisted",
    });

    expect(route.status).toBe(422);
    expect(tool).toEqual({ text: reasons.join(" "), isError: true });
  });

  it("Resolve conflicts refuses a Task with no pull request in the same words to the user and the Agent", async () => {
    const task = await create();

    const route = await sendJson(work, "POST", `/tasks/${task.id}/resolve-conflicts`);
    const reasons = workRefusalSchema.parse(await route.json()).reasons;
    const tool = await callTool(RESOLVE_CONFLICTS_ACTION.name, { taskId: task.id });

    expect(route.status).toBe(422);
    expect(tool).toEqual({ text: reasons.join(" "), isError: true });
  });

  it("confirm the Plan and the Definition of Done through the route and the tool alike", async () => {
    const task = await proposedTask();
    const other = await proposedTask();
    await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
    await sendJson(work, "PUT", `/tasks/${other.id}/plan`, { plan: "Mine." });
    await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Mine."],
    });
    await sendJson(work, "PUT", `/tasks/${other.id}/definition-of-done`, {
      definitionOfDone: ["Mine."],
    });

    const viaRoute = await sendJson(work, "POST", `/tasks/${task.id}/plan/confirm`);
    const planByTool = await callTool(CONFIRM_TASK_PLAN_ACTION.name, { taskId: other.id });
    const doneByTool = await callTool(CONFIRM_TASK_DEFINITION_OF_DONE_ACTION.name, {
      taskId: other.id,
    });

    expect(taskSchema.parse(await viaRoute.json()).planConfirmed).toBe(true);
    expect(planByTool.isError).toBe(false);
    expect(doneByTool.isError).toBe(false);
    expect(await work.app.get(TaskService).read(other.id)).toMatchObject({
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
    });
  });

  it("Place puts a Task on the board through the route and the tool alike", async () => {
    const task = await create();

    const route = await sendJson(work, "PUT", `/tasks/${task.id}/place`, {
      above: null,
      below: null,
    });
    const tool = await callTool(PLACE_TASK_ACTION.name, {
      taskId: task.id,
      above: null,
      below: null,
    });

    expect(route.status).toBe(200);
    expect(tool.isError).toBe(false);
  });
});

describe("the queue's actions", () => {
  it("answer 200 with an empty object to the web, and words to the Agent", async () => {
    const task = await readyTask();
    const queued = await readyTask();
    // Both wait on a blocker, so they queue.
    const blocker = await create({ title: "Blocker" });
    await sendJson(work, "POST", `/tasks/${task.id}/dependencies`, { blockerId: blocker.id });
    await sendJson(work, "POST", `/tasks/${queued.id}/dependencies`, { blockerId: blocker.id });
    await sendJson(work, "POST", `/tasks/${task.id}/start`, {});
    await sendJson(work, "POST", `/tasks/${queued.id}/start`, {});

    const up = await sendJson(work, "POST", `/queue/${queued.id}/move-up`);
    const top = await callTool(MOVE_TO_TOP_OF_QUEUE_ACTION.name, { taskId: queued.id });
    const out = await sendJson(work, "DELETE", `/queue/${task.id}`);
    const outByTool = await callTool(TAKE_OUT_OF_QUEUE_ACTION.name, { taskId: queued.id });
    const upByTool = await callTool(MOVE_UP_IN_QUEUE_ACTION.name, { taskId: queued.id });

    expect([up.status, out.status]).toEqual([200, 200]);
    expect(await up.json()).toEqual({});
    // The route moved it up to the first place, so the tool is refused as the route would be.
    expect(top).toEqual({ text: "The Task is already first in the queue.", isError: true });
    expect(outByTool.isError).toBe(false);
    expect(upByTool.isError).toBe(true);
  });
});

describe("save_view and delete_view", () => {
  it("save and delete a Saved view through the route and the tool alike", async () => {
    const saved = await sendJson(work, "POST", "/saved-views", {
      name: "Mine",
      filters: { priority: "high" },
    });
    const view = savedViewSchema.parse(await saved.json());
    const byTool = await callTool(SAVE_VIEW_ACTION.name, {
      name: "Theirs",
      filters: { priority: "high" },
    });
    const removed = await sendJson(work, "DELETE", `/saved-views/${view.id}`);
    const listed = savedViewListSchema.parse(
      await (await sendJson(work, "GET", "/saved-views")).json(),
    );
    const theirs = listed.find(({ name }) => name === "Theirs");
    const removedByTool = await callTool(DELETE_VIEW_ACTION.name, { id: theirs?.id });

    expect(saved.status).toBe(200);
    expect(byTool).toEqual({ text: `The view "Theirs" is saved.`, isError: false });
    expect(removed.status).toBe(200);
    expect(listed.map(({ name }) => name)).not.toContain("Mine");
    expect(removedByTool.isError).toBe(false);
    expect(
      savedViewListSchema.parse(await (await sendJson(work, "GET", "/saved-views")).json()),
    ).not.toContainEqual(expect.objectContaining({ name: "Theirs" }));
  });
});

describe("make_a_plan and plan_with", () => {
  it("move a Task to Planning through the tool, by the person", async () => {
    const planned = await create();
    const withPlanner = await create();

    const planWith = await callTool(PLAN_WITH_ACTION.name, { taskId: planned.id });
    const makeAPlan = await callTool(MAKE_A_PLAN_ACTION.name, {
      taskId: withPlanner.id,
      autoMode: false,
    });

    expect(planWith.isError).toBe(false);
    expect(makeAPlan).toEqual({
      text: `"Fix the login redirect" is in Planning, the Planner at work on it.`,
      isError: false,
    });
    for (const task of [planned, withPlanner]) {
      expect((await work.app.get(TaskService).stateChangesOf(task.id)).at(-1)).toMatchObject({
        to: "planning",
        by: { kind: "person", roleKey: "planner", askedBy: ASKED_BY },
      });
    }
  });
});
