import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADD_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
  taskSchema,
  workRefusalSchema,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { FOLLOW_YOUR_AUTHORITY, OfficeToolRegistry } from "../../../engine/index.js";
import { TaskService } from "../../application/task-service.js";
import { aProjectId, initiativesHttp } from "../../initiatives.controller.fixtures.js";
import { SessionPeopleForTests } from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";

let officeData: string;
let work: WorkApplication;
const http = initiativesHttp(() => work);

const SHAPER_SESSION = "shaper-session";
const ACTIONS = [
  ADD_DEPENDENCY_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
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
  const [tool] = work.app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, anOfficeToolCall(sessionId));
}

async function refusalOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return workRefusalSchema.parse(await response.json()).reasons;
}

describe("the derived Office tools", () => {
  it("cover each action by its declared duties, and say the Role's authority gates them", () => {
    const registry = work.app.get(OfficeToolRegistry);

    expect(registry.coveredBy(["shapes-initiatives"])).toEqual(ACTIONS.map(({ name }) => name));
    expect(registry.coveredBy(["plans"])).toEqual(ACTIONS.map(({ name }) => name));
    expect(registry.coveredBy(["reviews", "implements"])).toEqual([]);
    for (const action of ACTIONS) {
      const [tool] = registry.named([action.name]);
      expect(tool).toMatchObject({
        description: `${action.description} ${FOLLOW_YOUR_AUTHORITY}`,
        coveredBy: action.duties,
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
