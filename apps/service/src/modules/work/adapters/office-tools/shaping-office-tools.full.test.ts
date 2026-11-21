import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPEN_DECISION_TOOL } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { READING_OFFICE_TOOLS } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import type { Initiative } from "../../domain/initiative.js";
import { shapingInstructions } from "../../domain/shaping.js";
import { defaultWorkPrompts } from "../../domain/work-prompt-templates.fixtures.js";
import type { Task } from "../../domain/task.js";
import {
  ProposalDraftsForTests,
  SessionInitiativesForTests,
  UNKNOWN_PROJECT,
} from "../../ports/work-ports.fixtures.js";
import {
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { SHAPING_OFFICE_TOOLS } from "../conversations/initiative-thread-records.js";
import {
  ADD_TASK,
  READ_INITIATIVE,
  WRITE_OUTCOME,
  WRITE_TASK_DESCRIPTION,
  WRITE_TASK_TITLE,
} from "./shaping-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";

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
    .capture({ title: "Offline sync", notes: "", projectId: undefined }, ANN_LEE);
  initiative = await work.app.get(InitiativeService).shape(idea.id, ANN_LEE);
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
  return tool.run(input, anOfficeToolCall(sessionId));
}

function current(): Promise<Initiative> {
  return work.app.get(InitiativeService).read(initiative.id);
}

async function aTaskOutside(title: string): Promise<Task> {
  return work.app
    .get(TaskService)
    .create({ title, projectId: aProjectId(), priority: "normal" }, ANN_LEE);
}

async function anInitiativeTask(title: string): Promise<Task> {
  return work.app
    .get(InitiativeService)
    .addTask(initiative.id, { title, projectId: aProjectId(), priority: "normal" }, [], ANN_LEE);
}

it("gives a shaping session every reading tool", () => {
  expect(SHAPING_OFFICE_TOOLS).toEqual(expect.arrayContaining([...READING_OFFICE_TOOLS]));
});

it("are among a shaping session's Office tools", () => {
  expect(SHAPING_OFFICE_TOOLS).toEqual(
    expect.arrayContaining([
      READ_INITIATIVE,
      WRITE_OUTCOME,
      ADD_TASK,
      WRITE_TASK_TITLE,
      WRITE_TASK_DESCRIPTION,
      OPEN_DECISION_TOOL,
    ]),
  );
});

it("tell the shaper to ask the user's choices in one Decision on no Task, then end the turn", () => {
  expect(shapingInstructions(defaultWorkPrompts())).toContain(
    "When you need the user's choices, ask them in one Decision with open_decision, leaving taskId out",
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
  it("adds a Task in Shaping to the Initiative in the person's name", async () => {
    const projectId = aProjectId();

    const result = await call(ADD_TASK, { title: "Queue schema", projectId });

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(task).toMatchObject({
      title: "Queue schema",
      projectId,
      state: "shaping",
      priority: "normal",
      initiativeId: initiative.id,
      createdBy: { kind: "person", roleKey: "planner" },
    });
    expect(result).toEqual({
      text: `Added the Task "Queue schema" (Task ${task?.id}) in Shaping in ${projectId}, on the Initiative's page.`,
      isError: false,
    });
  });

  it("gives the new Task the Description it names", async () => {
    await call(ADD_TASK, {
      title: "Queue schema",
      projectId: aProjectId(),
      description: "  Writes wait in a table. ",
    });

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(task?.description).toBe("Writes wait in a table.");
  });

  it("adds it waiting for the Tasks it names, while shaping", async () => {
    const schema = await aTaskOutside("Queue schema");
    const projectId = aProjectId();

    const result = await call(ADD_TASK, {
      title: "Queue writes",
      projectId,
      blockedBy: [schema.id],
    });

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(task?.blockedBy).toEqual([schema.id]);
    expect(result.text).toBe(
      `Added the Task "Queue writes" (Task ${task?.id}) in Shaping in ${projectId}, waiting for "Queue schema", on the Initiative's page.`,
    );
  });

  it("adds nothing waiting for a Task that isn't there", async () => {
    const result = await call(ADD_TASK, {
      title: "Queue writes",
      projectId: aProjectId(),
      blockedBy: ["gone"],
    });

    expect(result).toEqual({
      text: expect.stringContaining('There is no Task "gone".'),
      isError: true,
    });
    expect((await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id)).toBe(
      undefined,
    );
  });
});

describe("write_task_title and write_task_description", () => {
  it("rewrite one of its Tasks straight away, and announce it", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    work.published.length = 0;

    const titled = await call(WRITE_TASK_TITLE, { taskId: queue.id, title: " Keep the queue " });
    const described = await call(WRITE_TASK_DESCRIPTION, {
      taskId: queue.id,
      description: "Writes survive a restart.",
    });

    expect(titled).toEqual({
      text: `The Task ${queue.id} is now titled "Keep the queue", on the Initiative's page.`,
      isError: false,
    });
    expect(described).toEqual({
      text: `Wrote the Description of "Keep the queue" onto its page.`,
      isError: false,
    });
    expect(await work.app.get(TaskService).read(queue.id)).toMatchObject({
      title: "Keep the queue",
      description: "Writes survive a restart.",
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.title-changed", taskId: queue.id },
      { type: "task.description-changed", taskId: queue.id },
    ]);
  });

  it("refuse a Task that isn't the Initiative's, a missing one and a wrong title", async () => {
    const outside = await aTaskOutside("Billing schema");
    const queue = await anInitiativeTask("Store the queue on flash");
    const missing = randomUUID();

    expect(await call(WRITE_TASK_TITLE, { taskId: outside.id, title: "Mine now" })).toEqual({
      text: `The Task "Billing schema" isn't one of this Initiative's.`,
      isError: true,
    });
    expect(await call(WRITE_TASK_DESCRIPTION, { taskId: missing, description: "Why" })).toEqual({
      text: `There is no Task "${missing}".`,
      isError: true,
    });
    expect(await call(WRITE_TASK_TITLE, { taskId: queue.id, title: "Two\nlines" })).toEqual({
      text: "A Task's title must be one line.",
      isError: true,
    });
    expect((await work.app.get(TaskService).read(outside.id)).title).toBe("Billing schema");
  });

  it("say so when the Task already reads that way", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");

    expect(await call(WRITE_TASK_TITLE, { taskId: queue.id, title: queue.title })).toEqual({
      text: `The title of "Store the queue on flash" says so already.`,
      isError: true,
    });
    expect(await call(WRITE_TASK_DESCRIPTION, { taskId: queue.id, description: "" })).toEqual({
      text: `The Description of "Store the queue on flash" says so already.`,
      isError: true,
    });
  });
});

describe("once the Initiative is active", () => {
  it("each tool drafts a Proposal of the change in the session's Thread, changing nothing yet", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    const schema = await aTaskOutside("Queue schema");
    await work.app.get(InitiativeService).confirm(initiative.id, ANN_LEE);
    const projectId = aProjectId();

    const answers = [
      await call(WRITE_OUTCOME, { outcome: "Sync works." }),
      await call(ADD_TASK, {
        title: "Retry",
        projectId,
        description: "Writes try again.",
        blockedBy: [schema.id],
      }),
      await call(WRITE_TASK_TITLE, { taskId: queue.id, title: "Keep the queue" }),
      await call(WRITE_TASK_DESCRIPTION, { taskId: queue.id, description: "It survives." }),
    ];

    expect(answers).toEqual(Array.from({ length: 4 }, () => ({ text: PROPOSED, isError: false })));
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual(
      [
        { kind: "outcome", outcome: "Sync works." },
        {
          kind: "add-task",
          title: "Retry",
          projectId,
          priority: "normal",
          description: "Writes try again.",
          blockedBy: [schema.id],
          taskId: undefined,
        },
        { kind: "task-title", taskId: queue.id, title: "Keep the queue" },
        { kind: "task-description", taskId: queue.id, description: "It survives." },
      ].map((edit) => ({
        sessionId: SESSION,
        change: { kind: "initiative", initiativeId: initiative.id, edit },
      })),
    );
    expect((await current()).outcome).toBe("");
    expect((await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id)).toEqual([
      { ...queue, state: "backlog" },
    ]);
  });

  it("drafts no change that is wrong, or that changes nothing", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    await work.app.get(InitiativeService).confirm(initiative.id, ANN_LEE);

    expect(await call(ADD_TASK, { title: "Retry", projectId: UNKNOWN_PROJECT })).toMatchObject({
      isError: true,
    });
    expect(await call(WRITE_TASK_TITLE, { taskId: queue.id, title: " " })).toEqual({
      text: "Give the Task a title.",
      isError: true,
    });
    expect(await call(WRITE_TASK_TITLE, { taskId: queue.id, title: queue.title })).toEqual({
      text: `The title of "Store the queue on flash" says so already.`,
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });

  it("drafts no change of a Task past Start, or of another Initiative's", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    const outside = await aTaskOutside("Billing schema");
    await work.app.get(InitiativeService).confirm(initiative.id, ANN_LEE);
    await work.app.get(TaskService).drop(queue.id, ANN_LEE);

    expect(await call(WRITE_TASK_TITLE, { taskId: queue.id, title: "Keep it" })).toEqual({
      text: "A Task keeps its title once it is Done or Dropped.",
      isError: true,
    });
    expect(await call(WRITE_TASK_DESCRIPTION, { taskId: queue.id, description: "Why" })).toEqual({
      text: "A Task keeps its Description once it has started.",
      isError: true,
    });
    expect(await call(WRITE_TASK_TITLE, { taskId: outside.id, title: "Mine" })).toEqual({
      text: `The Task "Billing schema" isn't one of this Initiative's.`,
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });
});

describe("once the Initiative is dropped", () => {
  it("each tool is refused and drafts nothing", async () => {
    await work.app.get(InitiativeService).drop(initiative.id, ANN_LEE);

    expect(await call(WRITE_OUTCOME, { outcome: "Sync works." })).toEqual({
      text: "The Initiative is dropped: its outcome is written only while it is being shaped.",
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });

  it("refuses the title and Description of its Tasks, dropped with it, keeping them", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    await work.app.get(InitiativeService).confirm(initiative.id, ANN_LEE);
    await work.app.get(InitiativeService).drop(initiative.id, ANN_LEE);

    expect(await call(WRITE_TASK_TITLE, { taskId: queue.id, title: "Keep it" })).toEqual({
      text: "A Task keeps its title once it is Done or Dropped.",
      isError: true,
    });
    expect(await call(WRITE_TASK_DESCRIPTION, { taskId: queue.id, description: "Why" })).toEqual({
      text: "A Task keeps its Description once it has started.",
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
    expect((await work.app.get(TaskService).read(queue.id)).title).toBe(queue.title);
  });
});

it("refuses a session on no Initiative, as a chat's is", async () => {
  expect(await call(WRITE_OUTCOME, { outcome: "Sync works." }, CHAT_SESSION)).toEqual({
    text: "This tool works in a Thread on an Initiative, and this session is on none.",
    isError: true,
  });
});

describe("read_initiative", () => {
  it("reads any Initiative by its id, in a chat as anywhere", async () => {
    await call(WRITE_OUTCOME, { outcome: "Writes made offline reach the server." });

    const result = await call(READ_INITIATIVE, { initiativeId: initiative.id }, CHAT_SESSION);

    expect(result.isError).toBe(false);
    expect(result.text).toContain("Outcome:\nWrites made offline reach the server.");
  });

  it("asks a session on no Initiative for the id", async () => {
    expect(await call(READ_INITIATIVE, {}, CHAT_SESSION)).toEqual({
      text: "This session is on no Initiative: give the id of the Initiative to read.",
      isError: true,
    });
  });

  it("says when there is no Initiative with the id", async () => {
    const missing = randomUUID();

    expect(await call(READ_INITIATIVE, { initiativeId: missing }, CHAT_SESSION)).toEqual({
      text: `There is no Initiative "${missing}".`,
      isError: true,
    });
  });
});
