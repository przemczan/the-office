import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ideaSchema,
  initiativeSchema,
  taskSchema,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../engine/index.js";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import { InitiativeThreadSetups, TaskThreadSetups } from "../../conversations/index.js";
import {
  INITIATIVE_PLANNING_OFFICE_TOOLS,
  SHAPING_OFFICE_TOOLS,
} from "../adapters/conversations/initiative-thread-records.js";
import {
  MARK_PLANNED,
  PROPOSE_PIPELINE,
  START_PLANNING,
  WRITE_DEFINITION_OF_DONE,
  WRITE_PLAN,
  WRITE_TAGS,
} from "../adapters/office-tools/planning-office-tools.js";
import {
  INITIATIVE_PLANNING_INSTRUCTIONS,
  INITIATIVE_PLANNING_OPENING,
  INITIATIVE_PLANNING_THREAD_TITLE,
} from "../domain/initiative-planning.js";
import { SHAPING_INSTRUCTIONS } from "../domain/shaping.js";
import { TaskStateChanged } from "../domain/task-events.js";
import {
  InitiativeThreadsForTests,
  KnownPeopleForTests,
  SessionInitiativesForTests,
  SessionTasksForTests,
  TaskDecisionsForTests,
  WorkSettingsForTests,
} from "../ports/work-ports.fixtures.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSettings } from "../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;
let settings: WorkSettingsForTests;

const SESSION = "initiative-planning-session";

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-initiative-planning-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  // Its own settings: Plan the Initiative saves the auto mode default every file would read.
  settings = new WorkSettingsForTests();
  work = await startWorkApplication(officeData, [{ provide: WorkSettings, useValue: settings }]);
});

afterEach(async () => {
  await work.app.close();
});

async function post(path: string, body?: unknown): Promise<Response> {
  return sendJson(work, "POST", path, body);
}

async function postOk(path: string, body?: unknown): Promise<unknown> {
  const response = await post(path, body);
  expect(response.status).toBeLessThan(300);
  return response.json();
}

/** An Initiative being shaped, with Task A and Task B, B waiting for A. */
async function anInitiativeWithTwoTasks(): Promise<{
  initiative: Initiative;
  first: Task;
  second: Task;
}> {
  const projectId = `project-${randomUUID()}`;
  const idea = ideaSchema.parse(
    await postOk("/ideas", { title: "Usage exports", notes: "", projectId: null }),
  );
  const initiative = initiativeSchema.parse(await postOk(`/ideas/${idea.id}/initiative`));
  const add = async (title: string, blockedBy: readonly string[]) =>
    taskSchema.parse(
      await postOk(`/initiatives/${initiative.id}/tasks`, {
        title,
        projectId,
        priority: "normal",
        blockedBy,
      }),
    );
  const first = await add("Export API", []);
  const second = await add("Export button", [first.id]);
  return { initiative, first, second };
}

async function anActiveInitiative() {
  const shaped = await anInitiativeWithTwoTasks();
  await postOk(`/initiatives/${shaped.initiative.id}/confirm`);
  return shaped;
}

/** Plan the Initiative, the session put in the Thread it opened. */
async function planned(initiativeId: string, autoMode: boolean): Promise<Initiative> {
  const initiative = initiativeSchema.parse(
    await postOk(`/initiatives/${initiativeId}/planning`, { autoMode }),
  );
  const sessions = work.app.get(SessionInitiativesForTests);
  sessions.initiatives.set(SESSION, initiativeId);
  sessions.threads.set(SESSION, initiative.planningThreadId ?? "");
  return initiative;
}

function call(name: string, input: Record<string, unknown>, sessionId = SESSION) {
  const [tool] = work.app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, anOfficeToolCall(sessionId));
}

async function read(taskId: string): Promise<Task> {
  const response = await sendJson(work, "GET", `/tasks/${taskId}`);
  return taskSchema.parse(await response.json());
}

/** Writes the Task's parts by its id and marks it planned, as the Planner does in the Thread. */
async function planTask(taskId: string) {
  await call(WRITE_PLAN, { taskId, plan: "Add the endpoint.", filesToChange: ["src/export.ts"] });
  await call(WRITE_DEFINITION_OF_DONE, { taskId, statements: ["Exports download."] });
  await call(PROPOSE_PIPELINE, { taskId, pipelineId: "full", why: "It changes code." });
  await call(WRITE_TAGS, { taskId, tags: ["exports"] });
  return call(MARK_PLANNED, { taskId });
}

describe("Plan the Initiative", () => {
  it("opens one planning Thread with the Planner, keeps it and the auto mode, and saves the default", async () => {
    const { initiative } = await anActiveInitiative();

    const planning = await planned(initiative.id, true);

    const [opened] = work.app.get(InitiativeThreadsForTests).opened.slice(-1);
    expect(opened).toEqual({
      threadId: planning.planningThreadId,
      initiativeId: initiative.id,
      roleKey: "planner",
      title: INITIATIVE_PLANNING_THREAD_TITLE,
      opening: INITIATIVE_PLANNING_OPENING,
    });
    expect(planning.planningAutoMode).toBe(true);
    expect(await settings.autoMode()).toBe(true);
  });

  it("is refused with the reason unless the Initiative is active, a Planner is hired and a Task is in Backlog", async () => {
    const shaping = await anInitiativeWithTwoTasks();
    const notActive = await post(`/initiatives/${shaping.initiative.id}/planning`, {
      autoMode: false,
    });
    expect(notActive.status).toBe(422);
    expect(await notActive.json()).toMatchObject({
      reasons: [
        "Only an active Initiative is planned; this one is being shaped: confirm it first.",
      ],
    });

    const { initiative } = await anActiveInitiative();
    work.app.get(KnownPeopleForTests).vacant.add("planner");
    const noPlanner = await post(`/initiatives/${initiative.id}/planning`, { autoMode: false });
    expect(await noPlanner.json()).toMatchObject({
      reasons: ["Hire a Planner on People first: planning is a conversation with them."],
    });
    work.app.get(KnownPeopleForTests).vacant.delete("planner");
    const opened = work.app.get(InitiativeThreadsForTests).opened;
    expect(opened.filter(({ roleKey }) => roleKey === "planner")).toEqual([]);
  });

  it("is refused while a Task is still being planned in an earlier planning Thread, and once nothing is in Backlog", async () => {
    const { initiative, first, second } = await anActiveInitiative();
    const earlier = await planned(initiative.id, false);
    await call(START_PLANNING, { taskId: first.id });

    const again = await post(`/initiatives/${initiative.id}/planning`, { autoMode: false });
    expect(await again.json()).toMatchObject({
      reasons: [
        `"Export API" is still being planned in the earlier planning Thread (Thread ${earlier.planningThreadId}). Wait until it is marked planned there, or confirm it yourself.`,
      ],
    });

    await planTask(first.id);
    await call(START_PLANNING, { taskId: second.id });
    await planTask(second.id);
    const nothingLeft = await post(`/initiatives/${initiative.id}/planning`, { autoMode: false });
    expect(await nothingLeft.json()).toMatchObject({
      reasons: ["None of the Initiative's Tasks is in Backlog: nothing is left to plan."],
    });
  });
});

describe("planning the Initiative's Tasks in its planning Thread", () => {
  it("plans each Task in dependency order and, in auto mode, marks each Ready", async () => {
    const { initiative, first, second } = await anActiveInitiative();
    await planned(initiative.id, true);

    const tooEarly = await call(START_PLANNING, { taskId: second.id });
    expect(tooEarly).toEqual({
      text: `"Export button" waits for "Export API" (Task ${first.id}), which isn't planned yet: plan it first.`,
      isError: true,
    });

    expect(await call(START_PLANNING, { taskId: first.id })).toMatchObject({ isError: false });
    expect(await read(first.id)).toMatchObject({
      state: "planning",
      autoMode: true,
      initiativePlanningThreadId: (await readInitiative(initiative.id)).planningThreadId,
    });
    expect(await planTask(first.id)).toMatchObject({ isError: false });
    expect(await call(START_PLANNING, { taskId: second.id })).toMatchObject({ isError: false });
    await planTask(second.id);

    for (const id of [first.id, second.id]) {
      expect(await read(id)).toMatchObject({
        state: "ready",
        markedPlanned: true,
        plan: "Add the endpoint.",
        planConfirmed: true,
        filesToChange: ["src/export.ts"],
        definitionOfDoneConfirmed: true,
        pipelineId: "full",
        tags: ["exports"],
      });
    }
  });

  it("with auto mode off, marks each Task planned and leaves it in Planning for the user", async () => {
    const { initiative, first, second } = await anActiveInitiative();
    await planned(initiative.id, false);
    await call(START_PLANNING, { taskId: first.id });

    expect(await planTask(first.id)).toMatchObject({
      text: "Marked the Task planned. Auto mode is off: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.",
    });
    expect(await read(first.id)).toMatchObject({
      state: "planning",
      markedPlanned: true,
      planConfirmed: false,
    });
    // Marked planned counts as planned for the Tasks waiting for it.
    expect(await call(START_PLANNING, { taskId: second.id })).toMatchObject({ isError: false });
  });

  it("refuses the writing tools without a Task id, or for a Task not planned in the Thread", async () => {
    const { initiative, first, second } = await anActiveInitiative();
    await planned(initiative.id, false);
    await call(START_PLANNING, { taskId: first.id });

    expect(await call(WRITE_PLAN, { plan: "Add it." })).toEqual({
      text: "Name the Task by its id: this Thread plans the Initiative's Tasks.",
      isError: true,
    });
    expect(await call(WRITE_PLAN, { taskId: second.id, plan: "Add it." })).toEqual({
      text: `"Export button" is in Backlog: move it to Planning with ${START_PLANNING} first.`,
      isError: true,
    });
    const other = await anActiveInitiative();
    expect(await call(START_PLANNING, { taskId: other.first.id })).toEqual({
      text: `"Export API" isn't one of this Initiative's Tasks.`,
      isError: true,
    });
  });

  it("refuses start_planning outside the Initiative's latest planning Thread", async () => {
    const { initiative, first } = await anActiveInitiative();
    await planned(initiative.id, false);
    work.app.get(SessionInitiativesForTests).threads.set(SESSION, randomUUID());

    expect(await call(START_PLANNING, { taskId: first.id })).toEqual({
      text: "Only the Initiative's latest planning Thread moves its Tasks to Planning; this Thread is an earlier one.",
      isError: true,
    });
    expect(await call(START_PLANNING, { taskId: first.id }, "a-chat-session")).toMatchObject({
      isError: true,
    });
  });

  it("keeps the tools working on a Task's own Thread without a Task id", async () => {
    const { first } = await anActiveInitiative();
    await postOk(`/tasks/${first.id}/planning`);
    work.app.get(SessionTasksForTests).tasks.set("own-session", first.id);

    await call(WRITE_PLAN, { plan: "Add the endpoint." }, "own-session");

    expect(await read(first.id)).toMatchObject({ plan: "Add the endpoint." });
    expect(await read(first.id)).toMatchObject({ initiativePlanningThreadId: null });
  });
});

describe("a Decision on one of the Initiative's Tasks", () => {
  it("keeps it from being marked planned, in auto mode or not, and holds back only the Tasks waiting for it", async () => {
    for (const autoMode of [true, false]) {
      const { initiative, first, second } = await anActiveInitiative();
      await planned(initiative.id, autoMode);
      await call(START_PLANNING, { taskId: first.id });
      const decisions = work.app.get(TaskDecisionsForTests);
      decisions.open.set(first.id, 1);

      expect(await planTask(first.id)).toEqual({
        text: `The Task isn't marked planned: a Decision on it is still open. Keep planning the Tasks that don't wait for it, and end your turn once every Task left waits for an answer. The answer comes as a message: carry on from it, then call ${MARK_PLANNED} again.`,
        isError: true,
      });
      expect(await read(first.id)).toMatchObject({ state: "planning", markedPlanned: false });
      expect(await call(START_PLANNING, { taskId: second.id })).toMatchObject({ isError: true });

      decisions.open.delete(first.id);
      await call(MARK_PLANNED, { taskId: first.id });
      expect(await read(first.id)).toMatchObject({
        state: autoMode ? "ready" : "planning",
        markedPlanned: true,
      });
    }
  });

  it("is listed in the planning Thread's Brief with its Task, for a fresh session", async () => {
    const { initiative, first } = await anActiveInitiative();
    const planning = await planned(initiative.id, true);
    const threadId = planning.planningThreadId ?? "";
    work.app
      .get(TaskDecisionsForTests)
      .inThread.set(threadId, [{ taskId: first.id, question: "Which format?" }]);

    const setup = await work.app
      .get(InitiativeThreadSetups)
      .of({ threadId, initiativeId: initiative.id, roleKey: "planner" });

    expect(setup.record).toContain(
      `## Waiting for an answer\n\nThis Thread opened these Decisions, which still wait on the user: leave each Task, and the Tasks that wait for it, until its answer comes as a message.\n\n- "Export API" (Task ${first.id}): "Which format?"`,
    );
  });
});

/** An active Initiative planned in auto mode, both its Tasks Ready. */
async function bothReady() {
  const shaped = await anActiveInitiative();
  await planned(shaped.initiative.id, true);
  await call(START_PLANNING, { taskId: shaped.first.id });
  await planTask(shaped.first.id);
  await call(START_PLANNING, { taskId: shaped.second.id });
  await planTask(shaped.second.id);
  return shaped;
}

describe("rewriting an already planned Task from the planning Thread", () => {
  it("takes a Ready Task back to Backlog and into Planning here, and auto mode marks it Ready again", async () => {
    const { first } = await bothReady();
    const published = work.published.length;

    expect(
      await call(WRITE_PLAN, { taskId: first.id, plan: "Add the endpoint, CSV only." }),
    ).toMatchObject({ isError: false });

    expect(await read(first.id)).toMatchObject({
      state: "planning",
      markedPlanned: false,
      plan: "Add the endpoint, CSV only.",
      planConfirmed: false,
      definitionOfDoneConfirmed: true,
    });
    const moves = work.published
      .slice(published)
      .filter((event): event is TaskStateChanged => event instanceof TaskStateChanged)
      .map(({ from, to }) => [from, to]);
    expect(moves).toEqual([
      ["ready", "backlog"],
      ["backlog", "planning"],
    ]);
    const changes = await work.app.get(TaskRepository).stateChangesOf(first.id);
    expect(changes.slice(-2).map(({ from, to, by }) => ({ from, to, by }))).toEqual([
      { from: "ready", to: "backlog", by: { kind: "person", roleKey: "planner" } },
      { from: "backlog", to: "planning", by: { kind: "person", roleKey: "planner" } },
    ]);

    await call(MARK_PLANNED, { taskId: first.id });
    expect(await read(first.id)).toMatchObject({
      state: "ready",
      markedPlanned: true,
      planConfirmed: true,
    });
  });

  it("without auto mode leaves the rewritten Task in Planning for the user's Confirm", async () => {
    const { initiative, first, second } = await anActiveInitiative();
    await planned(initiative.id, false);
    await call(START_PLANNING, { taskId: first.id });
    await planTask(first.id);
    await call(START_PLANNING, { taskId: second.id });

    await call(WRITE_DEFINITION_OF_DONE, { taskId: first.id, statements: ["CSV downloads."] });
    expect(await read(first.id)).toMatchObject({ state: "planning", markedPlanned: false });
    expect(await call(MARK_PLANNED, { taskId: first.id })).toMatchObject({
      text: "Marked the Task planned. Auto mode is off: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.",
    });
    expect(await read(first.id)).toMatchObject({ state: "planning", markedPlanned: true });
  });

  it("never rewrites a Task that has started, or one planned in its own Thread", async () => {
    const { first, second } = await bothReady();
    await work.app.get(TaskRepository).update(first.id, (task) => ({
      task: { ...task, state: "in-progress" },
      event: new TaskStateChanged(task.id, task.state, "in-progress"),
    }));

    expect(await call(WRITE_PLAN, { taskId: first.id, plan: "Something else." })).toEqual({
      text: `"Export API" is in In progress; it has started and is never rewritten: open a Decision on it saying what changed and what you recommend.`,
      isError: true,
    });
    expect(await read(first.id)).toMatchObject({ state: "in-progress", plan: "Add the endpoint." });

    await work.app.get(TaskRepository).update(second.id, (task) => ({
      task: { ...task, state: "planning", initiativePlanningThreadId: undefined },
      event: new TaskStateChanged(task.id, task.state, "planning"),
    }));
    expect(await call(WRITE_PLAN, { taskId: second.id, plan: "Something else." })).toEqual({
      text: `"Export button" is being planned in its own planning Thread and is never rewritten from here: open a Decision on it saying what changed and what you recommend.`,
      isError: true,
    });
  });
});

describe("a Task planned in its Initiative's planning Thread", () => {
  it("counts that Thread as its planning Thread: the Planner's tab points to it and no Thread of its own opens", async () => {
    const { initiative, first } = await anActiveInitiative();
    const planning = await planned(initiative.id, false);
    await call(START_PLANNING, { taskId: first.id });
    const taskThreads = work.app.get(TaskThreadSetups);

    await expect(taskThreads.planningThreadElsewhere(first.id)).resolves.toEqual({
      initiativeId: initiative.id,
      threadId: planning.planningThreadId,
    });
    // Only the Planner's tab is refused (TaskConversations); anyone else may still be asked.
    await expect(taskThreads.readyForPersonsThread(first.id)).resolves.toBeUndefined();
    // Make a plan leaves it in Planning there, opening no Thread of its own.
    const plannedAgain = taskSchema.parse(
      await postOk(`/tasks/${first.id}/make-a-plan`, { autoMode: false }),
    );
    expect(plannedAgain.initiativePlanningThreadId).toBe(planning.planningThreadId);
  });

  it("has none once it is planned in a Thread of its own", async () => {
    const { first } = await anActiveInitiative();
    await postOk(`/tasks/${first.id}/planning`);

    await expect(
      work.app.get(TaskThreadSetups).planningThreadElsewhere(first.id),
    ).resolves.toBeUndefined();
  });
});

describe("a Thread on an Initiative's session", () => {
  it("shapes the Initiative with the CTO, and plans its Tasks with the Planner", async () => {
    const { initiative, first, second } = await anActiveInitiative();
    const planning = await planned(initiative.id, true);
    const setups = work.app.get(InitiativeThreadSetups);

    const shaping = await setups.of({
      threadId: randomUUID(),
      initiativeId: initiative.id,
      roleKey: "cto",
    });
    expect(shaping).toMatchObject({
      instructions: SHAPING_INSTRUCTIONS,
      officeTools: SHAPING_OFFICE_TOOLS,
    });

    const planningSetup = await setups.of({
      threadId: planning.planningThreadId ?? "",
      initiativeId: initiative.id,
      roleKey: "planner",
    });
    expect(planningSetup).toMatchObject({
      instructions: INITIATIVE_PLANNING_INSTRUCTIONS,
      officeTools: INITIATIVE_PLANNING_OFFICE_TOOLS,
      sessionRefusal: undefined,
    });
    expect(INITIATIVE_PLANNING_OFFICE_TOOLS).toContain("open_decision");
    for (const words of [
      `Usage exports (Initiative ${initiative.id})`,
      "## The Tasks to plan",
      `- "Export API" (Task ${first.id})`,
      `waits for "Export API" (Task ${first.id}, Backlog)`,
      `- "Export button" (Task ${second.id})`,
      "## The Projects it spans",
      "## The Pipelines",
      "## Auto mode\n\nOn:",
    ]) {
      expect(planningSetup.record).toContain(words);
    }
  });
});

async function readInitiative(id: string): Promise<Initiative> {
  const response = await sendJson(work, "GET", `/initiatives/${id}`);
  return initiativeSchema.parse(await response.json());
}
