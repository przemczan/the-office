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
import {
  ProposalDraftsForTests,
  SessionInitiativesForTests,
  UNKNOWN_PROJECT,
} from "../../ports/work-ports.fixtures.js";
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
const PROPOSED =
  "The Initiative is active, so this is drafted as a Proposal in this Thread: it changes the Initiative once the user applies it.";

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
    .addTask(initiative.id, { title, projectId: aProjectId(), priority: "normal" }, [], THE_USER);
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
      text: "Wrote the outcome onto the Initiative's page.",
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
      text: `Added the Task "Queue schema" (Task ${task?.id}) in Backlog in ${projectId}, on the Initiative's page.`,
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
      text: `"Store the queue on flash" now waits for "Queue schema" to be Done, on the Initiative's page.`,
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

describe("once the Initiative is active", () => {
  it("each tool drafts a Proposal of the change in the session's Thread, changing nothing yet", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    const schema = await aTaskOutside("Queue schema");
    await work.app.get(InitiativeService).confirm(initiative.id);
    const projectId = aProjectId();

    const answers = [
      await call(WRITE_OUTCOME, { outcome: "Sync works." }),
      await call(ADD_TASK, { title: "Retry", projectId }),
      await call(ADD_DEPENDENCY, { taskId: queue.id, blockerId: schema.id }),
    ];

    expect(answers).toEqual(Array.from({ length: 3 }, () => ({ text: PROPOSED, isError: false })));
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual(
      [
        { kind: "outcome", outcome: "Sync works." },
        { kind: "add-task", title: "Retry", projectId, priority: "normal", taskId: undefined },
        { kind: "add-dependency", taskId: queue.id, blockerId: schema.id },
      ].map((edit) => ({
        sessionId: SESSION,
        change: { kind: "initiative", initiativeId: initiative.id, edit },
      })),
    );
    expect((await current()).outcome).toBe("");
    expect((await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id)).toEqual([
      queue,
    ]);
  });

  it("drafts no change that is wrong, or that changes nothing", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    await work.app.get(InitiativeService).confirm(initiative.id);

    expect(await call(ADD_DEPENDENCY, { taskId: queue.id, blockerId: queue.id })).toMatchObject({
      isError: true,
    });
    expect(await call(REMOVE_DEPENDENCY, { taskId: queue.id, blockerId: queue.id })).toEqual({
      text: `"Store the queue on flash" no longer waits for the Task ${queue.id}, on the Initiative's page.`,
      isError: false,
    });
    expect(await call(ADD_TASK, { title: "Retry", projectId: UNKNOWN_PROJECT })).toMatchObject({
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });
});

describe("once the Initiative is dropped", () => {
  it("each tool is refused and drafts nothing", async () => {
    await work.app.get(InitiativeService).drop(initiative.id);

    expect(await call(WRITE_OUTCOME, { outcome: "Sync works." })).toEqual({
      text: "The Initiative is dropped: its outcome is written only while it is being shaped.",
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });
});

it("refuses a session on no Initiative, as a chat's is", async () => {
  expect(await call(WRITE_OUTCOME, { outcome: "Sync works." }, CHAT_SESSION)).toEqual({
    text: "This tool works in a Thread on an Initiative, and this session is on none.",
    isError: true,
  });
});
