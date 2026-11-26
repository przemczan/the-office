import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADD_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  ARCHIVE_INITIATIVE_ACTION,
  ARCHIVE_TASK_ACTION,
  CHANGE_TASK_DEFINITION_OF_DONE_ACTION,
  CHANGE_TASK_DESCRIPTION_ACTION,
  CHANGE_TASK_KIND_ACTION,
  CHANGE_TASK_PLAN_ACTION,
  CHANGE_TASK_PRIORITY_ACTION,
  CHANGE_TASK_TITLE_ACTION,
  CONFIRM_INITIATIVE_ACTION,
  DROP_IDEA_ACTION,
  DROP_INITIATIVE_ACTION,
  DROP_TASK_ACTION,
  EDIT_IDEA_ACTION,
  INITIATIVE_BACK_TO_SHAPING_ACTION,
  PAUSE_INITIATIVE_ACTION,
  PLAN_IDEA_AS_TASK_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  REOPEN_TASK_ACTION,
  RESTORE_IDEA_ACTION,
  RESTORE_INITIATIVE_ACTION,
  RESTORE_TASK_ACTION,
  RESUME_INITIATIVE_ACTION,
  SET_INITIATIVE_ENGINE_ACTION,
  SHAPE_IDEA_INTO_INITIATIVE_ACTION,
  SHAPE_IDEA_INTO_TASK_ACTION,
  START_READY_TASKS_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
  WRITE_INITIATIVE_SHORT_NAME_ACTION,
  WRITE_INITIATIVE_OUTCOME_ACTION,
  historySchema,
  ideaSchema,
  initiativePauseAnswerSchema,
  initiativeSchema,
  taskSchema,
  workRefusalSchema,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskService } from "../../application/task-service.js";
import { TaskStateChanged } from "../../domain/task-events.js";
import { aProjectId, initiativesHttp } from "../../initiatives.controller.fixtures.js";
import {
  SessionPeopleForTests,
  SessionTasksForTests,
  TaskThreadsForTests,
} from "../../ports/work-ports.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { WRITE_PLAN } from "../office-tools/planning-office-tools.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

let officeData: string;
let work: WorkApplication;
const http = initiativesHttp(() => work);

const SHAPER_SESSION = "shaper-session";
const CTO: { kind: "person"; roleKey: string } = { kind: "person", roleKey: "cto" };
/** The actions whoever shapes Initiatives or plans is covered for. */
const ACTIONS = [
  ADD_DEPENDENCY_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
];
/** The actions whoever can create a Task, an Idea or an Initiative is covered for, each. */
const TASK_CREATORS_ACTIONS = [
  CHANGE_TASK_TITLE_ACTION,
  CHANGE_TASK_DESCRIPTION_ACTION,
  CHANGE_TASK_KIND_ACTION,
  CHANGE_TASK_PRIORITY_ACTION,
  CHANGE_TASK_PLAN_ACTION,
  CHANGE_TASK_DEFINITION_OF_DONE_ACTION,
  DROP_TASK_ACTION,
  ARCHIVE_TASK_ACTION,
  RESTORE_TASK_ACTION,
];
const IDEA_CREATORS_ACTIONS = [EDIT_IDEA_ACTION, DROP_IDEA_ACTION, RESTORE_IDEA_ACTION];
const INITIATIVE_CREATORS_ACTIONS = [
  WRITE_INITIATIVE_OUTCOME_ACTION,
  DROP_INITIATIVE_ACTION,
  ARCHIVE_INITIATIVE_ACTION,
  RESTORE_INITIATIVE_ACTION,
  SET_INITIATIVE_ENGINE_ACTION,
  WRITE_INITIATIVE_SHORT_NAME_ACTION,
];
/** The actions that shape an Idea, ruled by Ideas. */
const IDEA_SHAPING_ACTIONS = [
  SHAPE_IDEA_INTO_TASK_ACTION,
  SHAPE_IDEA_INTO_INITIATIVE_ACTION,
  PLAN_IDEA_AS_TASK_ACTION,
];
/** The actions that run an Initiative. */
const RUNNING_ACTIONS = [
  CONFIRM_INITIATIVE_ACTION,
  INITIATIVE_BACK_TO_SHAPING_ACTION,
  START_READY_TASKS_ACTION,
  PAUSE_INITIATIVE_ACTION,
  RESUME_INITIATIVE_ACTION,
];

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-work-actions-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  work.app.get(SessionPeopleForTests).people.set(SHAPER_SESSION, "cto");
});

afterEach(async () => {
  await work.app.close();
});

async function aShapingInitiative(): Promise<Initiative> {
  return http.shape(await http.capture());
}

/** Confirmed with a Task of its own, as an Initiative is confirmed with its Tasks. */
async function anActiveInitiative(): Promise<Initiative> {
  const initiative = await aShapingInitiative();
  await http.addTask(initiative);
  expect((await http.post(initiative, "confirm")).status).toBe(200);
  return http.read(initiative);
}

async function aTaskInNoInitiative(title = "Offline banner"): Promise<Task> {
  const response = await sendJson(work, "POST", "/tasks", {
    title,
    projectId: aProjectId(),
    priority: "normal",
  });
  return taskSchema.parse(await response.json());
}

/** Calls the action's Office tool in `sessionId`, as a session of that person would. */
function callTool(name: string, input: Record<string, unknown>, sessionId = SHAPER_SESSION) {
  const [tool] = work.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, anOfficeToolCall(sessionId));
}

async function refusalOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return workRefusalSchema.parse(await response.json()).reasons;
}

describe("the derived Office tools", () => {
  it("carry each action's description, input and the group and subject its Authority rules by", () => {
    const registry = work.app.get(OfficeToolRegistry);

    for (const action of [
      ...ACTIONS,
      ...TASK_CREATORS_ACTIONS,
      ...IDEA_CREATORS_ACTIONS,
      ...INITIATIVE_CREATORS_ACTIONS,
      ...IDEA_SHAPING_ACTIONS,
      ...RUNNING_ACTIONS,
    ]) {
      const [tool] = registry.named([action.name], RUN_EVERY_CALL);
      expect(tool).toMatchObject({
        description: action.description,
        authority: { group: action.group },
        input: action.input,
      });
    }
  });
});

describe("add_to_initiative and take_out_of_initiative", () => {
  it("add a Task to an active Initiative and take it out through the route, keeping its state", async () => {
    const initiative = await anActiveInitiative();
    const task = await aTaskInNoInitiative();
    work.published.length = 0;

    const added = await sendJson(work, "PUT", `/initiatives/${initiative.id}/tasks/${task.id}`);
    const joined = taskSchema.parse(await added.json());
    const taken = await sendJson(work, "DELETE", `/initiatives/${initiative.id}/tasks/${task.id}`);
    const left = taskSchema.parse(await taken.json());

    expect(added.status).toBe(200);
    expect(joined).toMatchObject({ initiativeId: initiative.id, state: "backlog" });
    expect(left).toMatchObject({ initiativeId: null, state: "backlog" });
    expect(webEventsOf(work)).toEqual(
      expect.arrayContaining([
        { type: "task.added-to-initiative", taskId: task.id, initiativeId: initiative.id },
        { type: "task.taken-out-of-initiative", taskId: task.id, initiativeId: initiative.id },
      ]),
    );
  });

  it("move a Task joining an Initiative being shaped to Shaping, by the person whose tool it was", async () => {
    const initiative = await aShapingInitiative();
    const task = await aTaskInNoInitiative();

    const answer = await callTool(ADD_TO_INITIATIVE_ACTION.name, {
      initiativeId: initiative.id,
      taskId: task.id,
    });
    const shaped = await work.app.get(TaskService).read(task.id);
    const out = await callTool(TAKE_OUT_OF_INITIATIVE_ACTION.name, {
      initiativeId: initiative.id,
      taskId: task.id,
    });

    expect(answer).toEqual({
      text: `"Offline banner" is in the Initiative "${initiative.name}" now, in Shaping.`,
      isError: false,
    });
    expect(shaped).toMatchObject({ initiativeId: initiative.id, state: "shaping" });
    expect(out.text).toBe(
      `"Offline banner" is out of the Initiative "${initiative.name}" now, in Backlog.`,
    );
    const changes = await work.app.get(TaskService).stateChangesOf(task.id);
    expect(changes.map(({ to, by }) => ({ to, by }))).toEqual([
      { to: "backlog", by: ANN_LEE },
      { to: "shaping", by: { kind: "person", roleKey: "cto" } },
      { to: "backlog", by: { kind: "person", roleKey: "cto" } },
    ]);
  });

  it("refuse a Task already in another Initiative in the same words to the user and the Agent", async () => {
    const first = await anActiveInitiative();
    const second = await anActiveInitiative();
    const task = await aTaskInNoInitiative();
    await sendJson(work, "PUT", `/initiatives/${first.id}/tasks/${task.id}`);

    const reasons = await refusalOf(
      await sendJson(work, "PUT", `/initiatives/${second.id}/tasks/${task.id}`),
    );
    const answer = await callTool(ADD_TO_INITIATIVE_ACTION.name, {
      initiativeId: second.id,
      taskId: task.id,
    });

    expect(reasons).toEqual([
      '"Offline banner" is in another Initiative already, and a Task is in at most one: take it out of that one first.',
    ]);
    expect(answer).toEqual({ text: reasons.join(" "), isError: true });
  });
});

describe("add_dependency and remove_dependency", () => {
  it("change what a Task of an active Initiative waits for straight away, with no Proposal", async () => {
    const initiative = await anActiveInitiative();
    const task = await aTaskInNoInitiative("Queue writes");
    const blocker = await aTaskInNoInitiative("Queue schema");
    await sendJson(work, "PUT", `/initiatives/${initiative.id}/tasks/${task.id}`);

    const added = await callTool(ADD_DEPENDENCY_ACTION.name, {
      taskId: task.id,
      blockerId: blocker.id,
    });
    const waiting = await work.app.get(TaskService).read(task.id);
    const removed = await sendJson(work, "DELETE", `/tasks/${task.id}/dependencies/${blocker.id}`);

    expect(added).toEqual({
      text: `"Queue writes" now waits for "Queue schema" to be Done.`,
      isError: false,
    });
    expect(waiting.blockedBy).toEqual([blocker.id]);
    expect(taskSchema.parse(await removed.json()).blockedBy).toEqual([]);
  });

  it("take out the direct waits a new one covers, on the Task and those waiting for it, saved and published", async () => {
    const schema = await aTaskInNoInitiative("Queue schema");
    const flash = await aTaskInNoInitiative("Store the queue on flash");
    const client = await aTaskInNoInitiative("Mobile sync client");
    const lights = await aTaskInNoInitiative("Status lights");
    const release = await aTaskInNoInitiative("Release the app");
    const wait = (taskId: string, blockerId: string) =>
      sendJson(work, "POST", `/tasks/${taskId}/dependencies`, { blockerId });
    await wait(flash.id, schema.id);
    await wait(flash.id, lights.id);
    await wait(client.id, schema.id);
    await wait(release.id, client.id);
    await wait(release.id, lights.id);
    // The flash store waits for the schema and the lights, which the client and the release, waiting
    // for the client, both wait for directly.
    work.published.length = 0;

    const answer = await callTool(ADD_DEPENDENCY_ACTION.name, {
      taskId: client.id,
      blockerId: flash.id,
    });
    const tasks = work.app.get(TaskService);

    expect((await tasks.read(client.id)).blockedBy).toEqual([flash.id]);
    expect((await tasks.read(release.id)).blockedBy).toEqual([client.id]);
    expect((await tasks.read(flash.id)).blockedBy).toEqual([schema.id, lights.id]);
    expect(webEventsOf(work)).toEqual(
      expect.arrayContaining([
        { type: "task.dependency-added", taskId: client.id, blockerId: flash.id },
        { type: "task.dependency-removed", taskId: client.id, blockerId: schema.id },
        { type: "task.dependency-removed", taskId: release.id, blockerId: lights.id },
      ]),
    );
    expect(answer).toEqual({
      text:
        `"Mobile sync client" now waits for "Store the queue on flash" to be Done.` +
        ` "Mobile sync client" no longer waits directly for "Queue schema": it waits for it through another Task it waits for.` +
        ` "Release the app" no longer waits directly for "Status lights": it waits for it through another Task it waits for.`,
      isError: false,
    });
  });

  it("leave out a wait the Task has through another already, and say so to the Agent", async () => {
    const schema = await aTaskInNoInitiative("Queue schema");
    const flash = await aTaskInNoInitiative("Store the queue on flash");
    const client = await aTaskInNoInitiative("Mobile sync client");
    await sendJson(work, "POST", `/tasks/${flash.id}/dependencies`, { blockerId: schema.id });
    await sendJson(work, "POST", `/tasks/${client.id}/dependencies`, { blockerId: flash.id });
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${client.id}/dependencies`, {
      blockerId: schema.id,
    });
    const answer = await callTool(ADD_DEPENDENCY_ACTION.name, {
      taskId: client.id,
      blockerId: schema.id,
    });

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).blockedBy).toEqual([flash.id]);
    expect(webEventsOf(work)).toEqual([]);
    expect(answer).toEqual({
      text: `"Mobile sync client" already waits for "Queue schema" through "Store the queue on flash", so no direct wait was added: a Task waits directly only for Tasks it doesn't already wait for through another Task.`,
      isError: false,
    });
  });

  it("refuse a wait on an archived Task in the same words to the user and the Agent", async () => {
    const task = await aTaskInNoInitiative("Queue writes");
    const blocker = await aTaskInNoInitiative("Queue schema");
    await http.end(blocker, "done");
    await work.app.get(TaskService).archive(blocker.id, ANN_LEE);

    const reasons = await refusalOf(
      await sendJson(work, "POST", `/tasks/${task.id}/dependencies`, { blockerId: blocker.id }),
    );
    const answer = await callTool(ADD_DEPENDENCY_ACTION.name, {
      taskId: task.id,
      blockerId: blocker.id,
    });

    expect(reasons).toEqual(['"Queue schema" is archived, so nothing waits for it.']);
    expect(answer).toEqual({ text: reasons.join(" "), isError: true });
  });

  it("answer 400 for an input the declaration's schema refuses", async () => {
    const task = await aTaskInNoInitiative();

    const response = await sendJson(work, "POST", `/tasks/${task.id}/dependencies`, {
      blockerId: "not-a-task",
    });

    expect(response.status).toBe(400);
  });
});

/** As a Start and the walk take a Task In progress, which this module leaves to Pipelines. */
async function startedWithoutAWalk(task: Task): Promise<void> {
  const { event } = await work.app.get(TaskRepository).update(task.id, (held) => ({
    task: { ...held, state: "in-progress" },
    event: new TaskStateChanged(held.id, held.state, "in-progress"),
  }));
  expect(event).toBeDefined();
}

async function historyOf(path: string) {
  const response = await sendJson(work, "GET", `${path}/history`);
  expect(response.status).toBe(200);
  return historySchema.parse(await response.json());
}

/** The edits of the record's History, with who made each. */
async function editsOf(path: string) {
  return (await historyOf(path)).flatMap((entry) =>
    entry.kind === "edit" ? [{ field: entry.field, by: entry.by }] : [],
  );
}

describe("a Task's title, Description, Kind and priority", () => {
  it("change through the route and the tool alike, each kept in its History with who made it", async () => {
    const task = await aTaskInNoInitiative();

    const titled = await sendJson(work, "PUT", `/tasks/${task.id}/title`, {
      title: "Offline banner, sticky",
    });
    const answer = await callTool(CHANGE_TASK_TITLE_ACTION.name, {
      taskId: task.id,
      title: "Sticky offline banner",
    });
    const described = await callTool(CHANGE_TASK_DESCRIPTION_ACTION.name, {
      taskId: task.id,
      description: "Keep it up while offline.",
    });
    const kind = await sendJson(work, "PUT", `/tasks/${task.id}/kind`, { kind: "bug" });
    const priority = await callTool(CHANGE_TASK_PRIORITY_ACTION.name, {
      taskId: task.id,
      priority: "high",
    });

    expect(titled.status).toBe(200);
    expect(taskSchema.parse(await titled.json()).title).toBe("Offline banner, sticky");
    expect(answer).toEqual({
      text: `"Offline banner, sticky" is titled "Sticky offline banner" now.`,
      isError: false,
    });
    expect(described).toEqual({
      text: `"Sticky offline banner" has the Description as given now.`,
      isError: false,
    });
    expect(taskSchema.parse(await kind.json()).kind).toBe("bug");
    expect(priority.text).toBe(`"Sticky offline banner" has high priority now.`);
    expect(await work.app.get(TaskService).read(task.id)).toMatchObject({
      title: "Sticky offline banner",
      description: "Keep it up while offline.",
      kind: "bug",
      priority: "high",
    });
    expect(await editsOf(`/tasks/${task.id}`)).toEqual([
      { field: "title", by: "the user Ann Lee" },
      { field: "title", by: "the person in the Role cto" },
      { field: "description", by: "the person in the Role cto" },
      { field: "kind", by: "the user Ann Lee" },
      { field: "priority", by: "the person in the Role cto" },
    ]);
  });

  it("keep no edit for a value that didn't change", async () => {
    const task = await aTaskInNoInitiative();

    await sendJson(work, "PUT", `/tasks/${task.id}/title`, { title: " Offline banner " });
    await callTool(CHANGE_TASK_PRIORITY_ACTION.name, { taskId: task.id, priority: "normal" });
    await callTool(CHANGE_TASK_KIND_ACTION.name, { taskId: task.id, kind: task.kind });

    expect(await editsOf(`/tasks/${task.id}`)).toEqual([]);
  });

  it("refuse a Description after Start and a title once Done, in the same words to both", async () => {
    const started = await aTaskInNoInitiative("Started");
    const done = await aTaskInNoInitiative("Done");
    await startedWithoutAWalk(started);
    await http.end(done, "done");

    const description = await refusalOf(
      await sendJson(work, "PUT", `/tasks/${started.id}/description`, { description: "Late." }),
    );
    const descriptionByTool = await callTool(CHANGE_TASK_DESCRIPTION_ACTION.name, {
      taskId: started.id,
      description: "Late.",
    });
    const title = await refusalOf(
      await sendJson(work, "PUT", `/tasks/${done.id}/title`, { title: "Renamed" }),
    );
    const titleByTool = await callTool(CHANGE_TASK_TITLE_ACTION.name, {
      taskId: done.id,
      title: "Renamed",
    });

    expect(description).toEqual(["A Task keeps its Description once it has started."]);
    expect(descriptionByTool).toEqual({ text: description.join(" "), isError: true });
    expect(title).toEqual(["A Task keeps its title once it is Done or Dropped."]);
    expect(titleByTool).toEqual({ text: title.join(" "), isError: true });
  });
});

describe("a Task's Plan and Definition of Done", () => {
  it("save as the user's Save does, Not confirmed and a Ready Task back to Backlog, kept with who saved each", async () => {
    const task = await aTaskInNoInitiative();
    await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Show a banner." });
    await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["The banner shows offline."],
    });
    await work.app.get(PlanningService).confirmPlan(task.id);
    await work.app.get(PlanningService).confirmDefinitionOfDone(task.id);
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "quick-fix" });
    await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    expect((await work.app.get(TaskService).read(task.id)).state).toBe("ready");

    const plan = await callTool(CHANGE_TASK_PLAN_ACTION.name, {
      taskId: task.id,
      plan: "Show a sticky banner.",
      filesToChange: ["src/banner.ts"],
    });
    const definitionOfDone = await callTool(CHANGE_TASK_DEFINITION_OF_DONE_ACTION.name, {
      taskId: task.id,
      definitionOfDone: ["The banner stays up offline."],
    });

    expect(plan).toEqual({
      text: `"Offline banner" has the Plan as given now, not yet confirmed, in Backlog.`,
      isError: false,
    });
    expect(definitionOfDone.text).toBe(
      `"Offline banner" has the Definition of Done as given now, not yet confirmed, in Backlog.`,
    );
    expect(await work.app.get(TaskService).read(task.id)).toMatchObject({
      state: "backlog",
      plan: "Show a sticky banner.",
      filesToChange: ["src/banner.ts"],
      planConfirmed: false,
      definitionOfDone: ["The banner stays up offline."],
      definitionOfDoneConfirmed: false,
    });
    expect(await editsOf(`/tasks/${task.id}`)).toEqual([
      { field: "plan", by: "the user Ann Lee" },
      { field: "definition-of-done", by: "the user Ann Lee" },
      { field: "plan", by: "the person in the Role cto" },
      { field: "definition-of-done", by: "the person in the Role cto" },
    ]);
  });

  it("keep the Planner's write_plan in the History as the person in the session's", async () => {
    const planningSession = "planning-session";
    const created = await work.app
      .get(TaskService)
      .create(
        { title: "Fix the login redirect", projectId: aProjectId(), priority: "normal" },
        ANN_LEE,
      );
    await work.app.get(PlanningService).plan(created.id, ANN_LEE);
    work.app.get(SessionTasksForTests).tasks.set(planningSession, created.id);

    const answer = await callTool(
      WRITE_PLAN,
      { plan: "Keep the requested path through the sign-in." },
      planningSession,
    );
    await callTool(
      WRITE_PLAN,
      { plan: "Keep the requested path through the sign-in." },
      planningSession,
    );

    expect(answer.isError).toBe(false);
    expect(await editsOf(`/tasks/${created.id}`)).toEqual([
      { field: "plan", by: "the person in the Role planner" },
    ]);
  });
});

describe("a Task's History", () => {
  it("merges its state changes and edits oldest first, with who made each", async () => {
    const task = await aTaskInNoInitiative();
    await sendJson(work, "PUT", `/tasks/${task.id}/title`, { title: "Sticky offline banner" });
    await callTool(DROP_TASK_ACTION.name, { taskId: task.id });

    const history = await historyOf(`/tasks/${task.id}`);

    expect(history.map(({ at: _at, ...entry }) => entry)).toEqual([
      { kind: "state-change", from: null, to: "backlog", by: "the user Ann Lee" },
      { kind: "edit", field: "title", by: "the user Ann Lee" },
      { kind: "state-change", from: "backlog", to: "dropped", by: "the person in the Role cto" },
    ]);
    const times = history.map(({ at }) => at);
    expect(times).toEqual(times.toSorted());
    expect(await work.app.get(TaskService).history(task.id)).toHaveLength(3);
  });

  it("names who proposed a change the user applied from a Proposal", async () => {
    const task = await aTaskInNoInitiative();
    const registry = work.app.get(OfficeToolRegistry);
    const input = { taskId: task.id, title: "Sticky offline banner" };

    const drafted = await registry.draft(CHANGE_TASK_TITLE_ACTION.name, input);
    await registry.applyFor(CHANGE_TASK_TITLE_ACTION.name, input, {
      user: { userId: "ann", name: "Ann Lee" },
      proposedBy: "cto",
    });

    expect(drafted).toMatchObject({
      subject: { kind: "task", id: task.id, title: "Offline banner" },
      fields: [
        { label: "Title", before: "Offline banner", after: "Sticky offline banner", form: "short" },
      ],
    });
    expect((await registry.draft(CHANGE_TASK_TITLE_ACTION.name, input))?.fingerprint).not.toBe(
      drafted?.fingerprint,
    );
    expect(await editsOf(`/tasks/${task.id}`)).toEqual([
      { field: "title", by: "the user Ann Lee, proposed by the person in the Role cto" },
    ]);
  });

  it("is in the Task's record, read_task's", async () => {
    const task = await aTaskInNoInitiative();
    await callTool(CHANGE_TASK_TITLE_ACTION.name, { taskId: task.id, title: "Renamed" });

    const [tool] = work.app.get(OfficeToolRegistry).named(["read_task"], RUN_EVERY_CALL);
    const record = (await tool?.run({ taskId: task.id }, anOfficeToolCall(SHAPER_SESSION)))?.text;
    const lines = (record ?? "").slice((record ?? "").indexOf("History:")).split("\n");

    expect(lines).toEqual([
      "History:",
      expect.stringMatching(/^- .+: created in Backlog, by the user Ann Lee$/),
      expect.stringMatching(/^- .+: Title edited, by the person in the Role cto$/),
    ]);
  });
});

describe("drop_task, archive_task and restore_task", () => {
  it("drop a Task with a Duplicate reason, archive and restore it, through the tool and the route", async () => {
    const task = await aTaskInNoInitiative();
    const original = await aTaskInNoInitiative("The original");

    const dropped = await callTool(DROP_TASK_ACTION.name, {
      taskId: task.id,
      reason: { kind: "duplicate", taskId: original.id },
    });
    const archived = await sendJson(work, "POST", `/tasks/${task.id}/archive`);
    const restored = await callTool(RESTORE_TASK_ACTION.name, { taskId: task.id });

    expect(dropped).toEqual({ text: `"Offline banner" is Dropped now.`, isError: false });
    expect(taskSchema.parse(await archived.json()).archivedAt).not.toBeNull();
    expect(restored.text).toBe(`"Offline banner" is back on the board now, in Dropped.`);
    expect(await work.app.get(TaskService).read(task.id)).toMatchObject({
      state: "dropped",
      dropReason: { kind: "duplicate", taskId: original.id },
      archivedAt: undefined,
      restoredBy: CTO,
    });
  });

  it("reopen a Task by reopen_task as the person's way back, with the users who asked and allowed it", async () => {
    const task = await aTaskInNoInitiative();
    await callTool(DROP_TASK_ACTION.name, { taskId: task.id });
    const ann = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
    work.app.get(SessionPeopleForTests).askedBy.set(SHAPER_SESSION, ann);
    const [tool] = work.app
      .get(OfficeToolRegistry)
      .named([REOPEN_TASK_ACTION.name], RUN_EVERY_CALL);
    const ben = { userId: "00000000-0000-4000-8000-0000000000be", name: "Ben Ito" };

    const reopened = await tool?.run(
      { taskId: task.id, to: "backlog", resetBranch: false },
      { ...anOfficeToolCall(SHAPER_SESSION), allowedBy: ben },
    );

    expect(reopened?.isError).toBe(false);
    expect((await work.app.get(TaskService).stateChangesOf(task.id)).at(-1)?.by).toMatchObject({
      ...CTO,
      askedBy: ann,
      allowedBy: ben,
      wayBack: { kind: "reopen", startedOver: null },
    });
  });

  it("refuse a Duplicate of no Task, and the archive of a Task not Done or Dropped, in the same words", async () => {
    const task = await aTaskInNoInitiative();
    const missing = "00000000-0000-4000-8000-00000000dead";

    const duplicate = await refusalOf(
      await sendJson(work, "POST", `/tasks/${task.id}/drop`, {
        reason: { kind: "duplicate", taskId: missing },
      }),
    );
    const duplicateByTool = await callTool(DROP_TASK_ACTION.name, {
      taskId: task.id,
      reason: { kind: "duplicate", taskId: missing },
    });
    const archive = await refusalOf(await sendJson(work, "POST", `/tasks/${task.id}/archive`));
    const archiveByTool = await callTool(ARCHIVE_TASK_ACTION.name, { taskId: task.id });

    expect(duplicate).toEqual([`There is no Task ${missing}.`]);
    expect(duplicateByTool).toEqual({ text: duplicate.join(" "), isError: true });
    expect(archive.length).toBeGreaterThan(0);
    expect(archiveByTool).toEqual({ text: archive.join(" "), isError: true });
  });

  it("refuse an Agent's Drop of a started Task, while the user's Drop of it goes through", async () => {
    const task = await aTaskInNoInitiative();
    await startedWithoutAWalk(task);

    const answer = await callTool(DROP_TASK_ACTION.name, { taskId: task.id });
    const stillStarted = await work.app.get(TaskService).read(task.id);
    const response = await sendJson(work, "POST", `/tasks/${task.id}/drop`);

    expect(answer).toEqual({
      text: `"Offline banner" has started, so only the user Drops it: ask them to.`,
      isError: true,
    });
    expect(stillStarted.state).toBe("in-progress");
    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).state).toBe("dropped");
  });

  it("let a Consultant's Drop answer to a Decision Drop a Paused Task their own drop_task can't", async () => {
    const tasks = work.app.get(TaskService);
    const task = await aTaskInNoInitiative();
    await startedWithoutAWalk(task);
    await tasks.hold(task.id, "Nobody fills the Role developer.");

    const answer = await callTool(DROP_TASK_ACTION.name, { taskId: task.id });
    const dropped = await tasks.dropAsAnswered(task.id, {
      decisionId: "00000000-0000-4000-8000-00000000d0d0",
      by: CTO,
    });

    expect(answer).toEqual({
      text: `"Offline banner" has started, so only the user Drops it: ask them to.`,
      isError: true,
    });
    expect(dropped.state).toBe("dropped");
    expect((await tasks.stateChangesOf(task.id)).at(-1)).toMatchObject({
      from: "paused",
      to: "dropped",
      by: CTO,
    });
  });
});

describe("edit_idea, drop_idea and restore_idea", () => {
  it("edit an Idea through the tool and the route, one edit kept per field that changed", async () => {
    const idea = await http.capture();
    const projectId = aProjectId();

    const answer = await callTool(EDIT_IDEA_ACTION.name, {
      ideaId: idea.id,
      title: "Usage exports as CSV",
      notes: "",
      projectId: null,
    });
    const edited = await sendJson(work, "PUT", `/ideas/${idea.id}`, {
      title: "Usage exports as CSV",
      notes: "For the accountants.",
      projectId,
    });
    await sendJson(work, "PUT", `/ideas/${idea.id}`, {
      title: "Usage exports as CSV",
      notes: "For the accountants.",
      projectId,
    });

    expect(answer).toEqual({
      text: `The Idea "Usage exports as CSV" reads as given now.`,
      isError: false,
    });
    expect(ideaSchema.parse(await edited.json())).toMatchObject({
      notes: "For the accountants.",
      projectId,
    });
    expect(await editsOf(`/ideas/${idea.id}`)).toEqual([
      { field: "title", by: "the person in the Role cto" },
      { field: "notes", by: "the user Ann Lee" },
      { field: "project", by: "the user Ann Lee" },
    ]);
  });

  it("drop and restore an Idea, and refuse a shaped one's Drop in the same words", async () => {
    const idea = await http.capture();
    const shaped = await http.capture();
    await http.shape(shaped);

    const dropped = await callTool(DROP_IDEA_ACTION.name, { ideaId: idea.id });
    const restored = await sendJson(work, "POST", `/ideas/${idea.id}/restore`);
    const again = await callTool(RESTORE_IDEA_ACTION.name, { ideaId: idea.id });
    const reasons = await refusalOf(await sendJson(work, "POST", `/ideas/${shaped.id}/drop`));
    const byTool = await callTool(DROP_IDEA_ACTION.name, { ideaId: shaped.id });

    expect(dropped.text).toBe(`The Idea "Usage exports" is Dropped now.`);
    expect(ideaSchema.parse(await restored.json()).state).toBe("new");
    expect(again.text).toBe(`The Idea "Usage exports" is new again.`);
    expect(reasons).toEqual(["A shaped Idea can't be dropped; drop its Initiative instead."]);
    expect(byTool).toEqual({ text: reasons.join(" "), isError: true });
  });
});

describe("write_initiative_outcome, drop_initiative, archive_initiative and restore_initiative", () => {
  it("write the outcome through the tool and the route, each kept with who wrote it", async () => {
    const initiative = await aShapingInitiative();

    const answer = await callTool(WRITE_INITIATIVE_OUTCOME_ACTION.name, {
      initiativeId: initiative.id,
      outcome: "Accountants get usage as CSV.",
    });
    const written = await sendJson(work, "PUT", `/initiatives/${initiative.id}/outcome`, {
      outcome: "Accountants get usage as CSV, monthly.",
    });
    await sendJson(work, "PUT", `/initiatives/${initiative.id}/outcome`, {
      outcome: "Accountants get usage as CSV, monthly.",
    });

    expect(answer).toEqual({
      text: `The Initiative "Usage exports" has the outcome as given now.`,
      isError: false,
    });
    expect(initiativeSchema.parse(await written.json()).outcome).toBe(
      "Accountants get usage as CSV, monthly.",
    );
    expect(await editsOf(`/initiatives/${initiative.id}`)).toEqual([
      { field: "outcome", by: "the person in the Role cto" },
      { field: "outcome", by: "the user Ann Lee" },
    ]);
  });

  it("drop an Initiative, archive and restore it", async () => {
    const initiative = await aShapingInitiative();

    const dropped = await callTool(DROP_INITIATIVE_ACTION.name, { initiativeId: initiative.id });
    const archived = await callTool(ARCHIVE_INITIATIVE_ACTION.name, {
      initiativeId: initiative.id,
    });
    const restored = await sendJson(work, "POST", `/initiatives/${initiative.id}/restore`);

    expect(dropped.text).toBe(`The Initiative "Usage exports" is Dropped now.`);
    expect(archived.text).toBe(
      `The Initiative "Usage exports" is in the Archive now, off the board, dropped.`,
    );
    expect(initiativeSchema.parse(await restored.json())).toMatchObject({
      state: "dropped",
      archivedAt: null,
    });
  });

  it("refuse an Agent's Drop of an Initiative with a started Task, while the user's Drop goes through", async () => {
    const initiative = await aShapingInitiative();
    const task = await http.addTask(initiative);
    expect((await http.post(initiative, "confirm")).status).toBe(200);
    await startedWithoutAWalk(task);

    const answer = await callTool(DROP_INITIATIVE_ACTION.name, { initiativeId: initiative.id });
    const response = await sendJson(work, "POST", `/initiatives/${initiative.id}/drop`);

    expect(answer).toEqual({
      text: `"Usage exports" has a Task that has started, "Export endpoint", so only the user Drops it: ask them to.`,
      isError: true,
    });
    expect(response.status).toBe(200);
    expect(initiativeSchema.parse(await response.json()).state).toBe("dropped");
    expect((await work.app.get(TaskService).read(task.id)).state).toBe("dropped");
  });

  it("refuse the archive of an Initiative being shaped in the same words to both", async () => {
    const initiative = await aShapingInitiative();

    const reasons = await refusalOf(
      await sendJson(work, "POST", `/initiatives/${initiative.id}/archive`),
    );
    const answer = await callTool(ARCHIVE_INITIATIVE_ACTION.name, { initiativeId: initiative.id });

    expect(reasons.length).toBeGreaterThan(0);
    expect(answer).toEqual({ text: reasons.join(" "), isError: true });
  });
});

describe("shaping an Idea", () => {
  it("makes a Task through the tool and the route alike, each Idea shown Shaped and answered 201", async () => {
    const byTool = await http.capture();
    const byRoute = await http.capture();
    const projectId = aProjectId();

    const answer = await callTool(SHAPE_IDEA_INTO_TASK_ACTION.name, {
      ideaId: byTool.id,
      projectId,
    });
    const response = await sendJson(work, "POST", `/ideas/${byRoute.id}/shape`, { projectId });

    expect(answer).toEqual({
      text: `The Idea is Shaped: "Usage exports" is in Backlog now.`,
      isError: false,
    });
    expect(response.status).toBe(201);
    expect(taskSchema.parse(await response.json()).projectId).toBe(projectId);
    for (const idea of [byTool, byRoute]) {
      const read = await sendJson(work, "GET", `/ideas/${idea.id}`);
      expect(ideaSchema.parse(await read.json()).state).toBe("shaped");
    }
  });

  it("makes an Initiative through the tool and the route alike", async () => {
    const byTool = await http.capture();
    const byRoute = await http.capture();

    const answer = await callTool(SHAPE_IDEA_INTO_INITIATIVE_ACTION.name, { ideaId: byTool.id });
    const initiative = await http.shape(byRoute);

    expect(answer).toEqual({
      text: `The Idea is Shaped: the Initiative "Usage exports" is being shaped, with no Tasks yet.`,
      isError: false,
    });
    expect(initiative.state).toBe("shaping");
    const read = await sendJson(work, "GET", `/ideas/${byTool.id}`);
    expect(ideaSchema.parse(await read.json())).toMatchObject({ state: "shaped" });
  });

  it("plans a Task through the tool, opening the Planner's Thread, as the route does", async () => {
    const idea = await http.capture();
    const projectId = aProjectId();

    const answer = await callTool(PLAN_IDEA_AS_TASK_ACTION.name, { ideaId: idea.id, projectId });

    expect(answer).toEqual({
      text: `The Idea is Shaped: "Usage exports" is in Planning, its planning Thread open.`,
      isError: false,
    });
    const [opened] = work.app.get(TaskThreadsForTests).opened;
    expect(opened).toMatchObject({ roleKey: "planner" });
    const read = await sendJson(work, "GET", `/ideas/${idea.id}`);
    expect(ideaSchema.parse(await read.json()).state).toBe("shaped");
  });

  it("refuses an Idea already shaped in the same words to the user and the Agent", async () => {
    const idea = await http.capture();
    await http.shape(idea);

    const response = await sendJson(work, "POST", `/ideas/${idea.id}/initiative`);
    const answer = await callTool(SHAPE_IDEA_INTO_INITIATIVE_ACTION.name, { ideaId: idea.id });

    const reasons = await refusalOf(response);
    expect(answer).toEqual({ text: reasons.join(" "), isError: true });
  });
});

describe("running an Initiative", () => {
  it("confirms through the tool, then goes back to Shaping through the route", async () => {
    const initiative = await aShapingInitiative();
    await http.addTask(initiative);

    const confirmed = await callTool(CONFIRM_INITIATIVE_ACTION.name, {
      initiativeId: initiative.id,
    });
    const back = await sendJson(work, "POST", `/initiatives/${initiative.id}/back-to-shaping`);

    expect(confirmed).toEqual({
      text: `The Initiative "Usage exports" is confirmed, active.`,
      isError: false,
    });
    expect(initiativeSchema.parse(await back.json()).state).toBe("shaping");
    const again = await callTool(INITIATIVE_BACK_TO_SHAPING_ACTION.name, {
      initiativeId: initiative.id,
    });
    expect(again.isError).toBe(true);
  });

  it("refuses Confirm of an active Initiative, and Start with no Ready Task, in the same words to both", async () => {
    const initiative = await anActiveInitiative();

    const confirmReasons = await refusalOf(await http.post(initiative, "confirm"));
    const confirm = await callTool(CONFIRM_INITIATIVE_ACTION.name, { initiativeId: initiative.id });
    const startReasons = await refusalOf(
      await sendJson(work, "POST", `/initiatives/${initiative.id}/start`),
    );
    const start = await callTool(START_READY_TASKS_ACTION.name, { initiativeId: initiative.id });

    expect(confirm).toEqual({ text: confirmReasons.join(" "), isError: true });
    expect(start).toEqual({ text: startReasons.join(" "), isError: true });
  });

  it("pauses and resumes through the tool and the route, refusing each out of turn alike", async () => {
    const initiative = await anActiveInitiative();

    const paused = await callTool(PAUSE_INITIATIVE_ACTION.name, { initiativeId: initiative.id });
    const resumed = await sendJson(work, "POST", `/initiatives/${initiative.id}/resume`);
    const reasons = await refusalOf(
      await sendJson(work, "POST", `/initiatives/${initiative.id}/resume`),
    );
    const resumedAgain = await callTool(RESUME_INITIATIVE_ACTION.name, {
      initiativeId: initiative.id,
    });

    expect(paused).toEqual({
      text: `The Initiative "Usage exports" is paused, with 0 of its Tasks paused.`,
      isError: false,
    });
    expect(initiativePauseAnswerSchema.parse(await resumed.json()).initiative.pausedAt).toBeNull();
    expect(resumedAgain).toEqual({ text: reasons.join(" "), isError: true });
  });
});

describe("set_initiative_engine and write_initiative_short_name", () => {
  it("change the engine and the Short name through the tool and the route", async () => {
    const initiative = await aShapingInitiative();

    const cleared = await callTool(SET_INITIATIVE_ENGINE_ACTION.name, {
      initiativeId: initiative.id,
      engineId: null,
    });
    const engine = await sendJson(work, "PUT", `/initiatives/${initiative.id}/engine`, {
      engineId: null,
    });
    const refused = await sendJson(work, "PUT", `/initiatives/${initiative.id}/short-name`, {
      shortName: "usage-csv",
    });
    const named = await callTool(WRITE_INITIATIVE_SHORT_NAME_ACTION.name, {
      initiativeId: initiative.id,
      shortName: "usage-csv",
    });

    expect(cleared.text).toBe(`The Initiative "Usage exports" has the engine as given now.`);
    expect(initiativeSchema.parse(await engine.json()).engineOverride).toBeNull();
    // With no Pipeline in any Project, the Initiative has no Short name to write.
    expect(refused.status).toBe(422);
    expect(named.isError).toBe(true);
  });
});
