import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import type { Initiative } from "../../domain/initiative.js";
import type { Task } from "../../domain/task.js";
import { SessionInitiativesForTests } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { SHAPING_OFFICE_TOOLS } from "../conversations/shaping-thread-setup.js";
import {
  ADD_DEPENDENCY,
  ADD_TASK,
  READ_INITIATIVE,
  REMOVE_DEPENDENCY,
  WRITE_OUTCOME,
} from "./shaping-office-tools.js";

let officeData: string;
let work: WorkApplication;
/** The shaping session's Initiative, being shaped. */
let initiative: Initiative;

const SESSION = "shaping-session";
const CHAT_SESSION = "chat-session";
const ON_THE_PAGE =
  "It shows on the Initiative's page at once; the user confirms the whole Initiative once it is agreed.";

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-shaping-tools-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  const idea = await work.app
    .get(IdeaService)
    .capture({ title: "Offline sync", notes: "", projectId: undefined }, THE_USER);
  initiative = await work.app.get(InitiativeService).shape(idea.id, THE_USER);
  work.app.get(SessionInitiativesForTests).initiatives.set(SESSION, initiative.id);
});

afterEach(async () => {
  await work.app.close();
});

/** A Project id of the test's own: every test file shares the database. */
function aProjectId(): string {
  return `project-${randomUUID()}`;
}

/** Calls the Office tool as the CTO's session on the Initiative would. */
function call(name: string, input: Record<string, unknown>, sessionId = SESSION) {
  const [tool] = work.app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, { sessionId });
}

function current(): Promise<Initiative> {
  return work.app.get(InitiativeService).read(initiative.id);
}

async function aTaskOutside(title: string): Promise<Task> {
  return work.app
    .get(TaskService)
    .create({ title, projectId: aProjectId(), priority: "normal" }, THE_USER);
}

async function anInitiativeTask(title: string): Promise<Task> {
  return work.app
    .get(InitiativeService)
    .addTask(initiative.id, { title, projectId: aProjectId(), priority: "normal" }, THE_USER);
}

it("are among a shaping session's Office tools", () => {
  expect(SHAPING_OFFICE_TOOLS).toEqual(
    expect.arrayContaining([
      READ_INITIATIVE,
      WRITE_OUTCOME,
      ADD_TASK,
      ADD_DEPENDENCY,
      REMOVE_DEPENDENCY,
    ]),
  );
});

describe("write_outcome", () => {
  it("writes the outcome straight onto the session's Initiative, which read_initiative reads", async () => {
    const result = await call(WRITE_OUTCOME, { outcome: "Writes made offline reach the server." });

    expect(result).toEqual({
      text: `Wrote the outcome onto the Initiative. ${ON_THE_PAGE}`,
      isError: false,
    });
    expect((await current()).outcome).toBe("Writes made offline reach the server.");
    expect((await call(READ_INITIATIVE, {})).text).toContain(
      "Outcome:\nWrites made offline reach the server.",
    );
  });
});

describe("add_task", () => {
  it("adds a Task in Backlog to the Initiative in the person's name", async () => {
    const projectId = aProjectId();

    const result = await call(ADD_TASK, { title: "Queue schema", projectId });

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(task).toMatchObject({
      title: "Queue schema",
      projectId,
      state: "backlog",
      priority: "normal",
      initiativeId: initiative.id,
      createdBy: { kind: "person", roleKey: "planner" },
    });
    expect(result).toEqual({
      text: `Added the Task "Queue schema" (Task ${task?.id}) in Backlog in ${projectId}. ${ON_THE_PAGE}`,
      isError: false,
    });
  });
});

describe("add_dependency and remove_dependency", () => {
  it("make one of its Tasks wait for any Task, and stop waiting", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    const schema = await aTaskOutside("Queue schema");

    const added = await call(ADD_DEPENDENCY, { taskId: queue.id, blockerId: schema.id });
    const waiting = await work.app.get(TaskService).read(queue.id);
    const removed = await call(REMOVE_DEPENDENCY, { taskId: queue.id, blockerId: schema.id });

    expect(added).toEqual({
      text: `"Store the queue on flash" now waits for "Queue schema" to be Done. ${ON_THE_PAGE}`,
      isError: false,
    });
    expect(waiting.blockedBy).toEqual([schema.id]);
    expect(removed.isError).toBe(false);
    expect((await work.app.get(TaskService).read(queue.id)).blockedBy).toEqual([]);
  });

  it("refuse a Task that isn't the Initiative's, and a cycle", async () => {
    const outside = await aTaskOutside("Billing schema");
    const queue = await anInitiativeTask("Store the queue on flash");
    const protocol = await anInitiativeTask("Sync protocol messages");
    await call(ADD_DEPENDENCY, { taskId: protocol.id, blockerId: queue.id });

    const notIts = await call(ADD_DEPENDENCY, { taskId: outside.id, blockerId: queue.id });
    const cycle = await call(ADD_DEPENDENCY, { taskId: queue.id, blockerId: protocol.id });

    expect(notIts).toEqual({
      text: `The Task "Billing schema" isn't one of this Initiative's.`,
      isError: true,
    });
    expect(cycle.isError).toBe(true);
    expect((await work.app.get(TaskService).read(outside.id)).blockedBy).toEqual([]);
  });
});

describe("once the Initiative is no longer being shaped", () => {
  it("each tool is refused and changes nothing", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    const schema = await aTaskOutside("Queue schema");
    await work.app.get(InitiativeService).confirm(initiative.id);
    const refusal =
      "The Initiative is active: its Tasks and their dependencies change straight onto it only while it is being shaped.";

    expect(await call(WRITE_OUTCOME, { outcome: "Sync works." })).toEqual({
      text: "The Initiative is active: its outcome is written only while it is being shaped.",
      isError: true,
    });
    expect(await call(ADD_TASK, { title: "Retry", projectId: aProjectId() })).toEqual({
      text: refusal,
      isError: true,
    });
    expect(await call(ADD_DEPENDENCY, { taskId: queue.id, blockerId: schema.id })).toEqual({
      text: refusal,
      isError: true,
    });
    expect((await current()).outcome).toBe("");
    expect((await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id)).toEqual([
      queue,
    ]);
  });
});

it("refuses a session on no Initiative, as a chat's is", async () => {
  expect(await call(WRITE_OUTCOME, { outcome: "Sync works." }, CHAT_SESSION)).toEqual({
    text: "This tool works in a Thread on an Initiative, and this session is on none.",
    isError: true,
  });
});
