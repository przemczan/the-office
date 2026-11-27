import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADD_TASK_ACTION,
  CHANGE_TASK_DESCRIPTION_ACTION,
  CHANGE_TASK_TITLE_ACTION,
  CHOOSE_PIPELINE_ACTION,
  OPEN_DECISION_TOOL,
  WRITE_INITIATIVE_OUTCOME_ACTION,
} from "@the-office/contracts";
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
  SessionInitiativesForTests,
  SessionPeopleForTests,
  UNKNOWN_PROJECT,
} from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { SHAPING_OFFICE_TOOLS } from "../conversations/initiative-thread-records.js";
import { READ_INITIATIVE } from "./shaping-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The shaping session's Initiative, being shaped. */
let initiative: Initiative;

const SESSION = "shaping-session";
const CHAT_SESSION = "chat-session";
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
  work.app.get(SessionPeopleForTests).people.set(SESSION, "cto");
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
  const [tool] = work.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  // As the engine does, so the schema's defaults are in the input.
  return tool.run(tool.input.parse(input), anOfficeToolCall(sessionId));
}

/** What the ruling step reads of the tool's call: the least freedom its Authority may give it. */
async function floorOf(name: string, input: Record<string, unknown>) {
  const [tool] = work.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  return tool?.authority?.floor?.(input);
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
    expect.arrayContaining([READ_INITIATIVE, OPEN_DECISION_TOOL]),
  );
});

it("tell the shaper to ask the user's choices in one Decision on no Task, then end the turn", () => {
  expect(shapingInstructions(defaultWorkPrompts())).toContain(
    "When you need the user's choices, ask them in one Decision with open_decision, leaving taskId out",
  );
});

describe("write_initiative_outcome", () => {
  it("writes the outcome straight onto a shaping Initiative, which read_initiative reads", async () => {
    const result = await call(WRITE_INITIATIVE_OUTCOME_ACTION.name, {
      initiativeId: initiative.id,
      outcome: "Writes made offline reach the server.",
    });

    expect(result.isError).toBe(false);
    expect((await current()).outcome).toBe("Writes made offline reach the server.");
    expect((await call(READ_INITIATIVE, {})).text).toContain(
      "Outcome:\nWrites made offline reach the server.",
    );
  });

  it("is refused for an empty outcome as the user's route refuses it", async () => {
    const tool = await call(WRITE_INITIATIVE_OUTCOME_ACTION.name, {
      initiativeId: initiative.id,
      outcome: " ",
    });
    const route = await sendJson(work, "PUT", `/initiatives/${initiative.id}/outcome`, {
      outcome: " ",
    });

    expect(route.status).toBe(422);
    expect(tool).toEqual({
      text: "Write what must be true once the Initiative is done.",
      isError: true,
    });
  });
});

describe("add_task", () => {
  it("adds a Task in Shaping to the Initiative in the person's name", async () => {
    const projectId = aProjectId();

    const result = await call(ADD_TASK_ACTION.name, {
      initiativeId: initiative.id,
      title: "Queue schema",
      projectId,
    });

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(task).toMatchObject({
      title: "Queue schema",
      projectId,
      state: "shaping",
      priority: "normal",
      initiativeId: initiative.id,
      createdBy: { kind: "person", roleKey: "cto" },
    });
    expect(result).toEqual({
      text: `Added the Task "Queue schema" (Task ${task?.id}) in Shaping in ${projectId}, on the Initiative's page.`,
      isError: false,
    });
  });

  it("adds it waiting for the Tasks it names", async () => {
    const schema = await aTaskOutside("Queue schema");

    const result = await call(ADD_TASK_ACTION.name, {
      initiativeId: initiative.id,
      title: "Queue writes",
      projectId: aProjectId(),
      blockedBy: [schema.id],
    });

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(task?.blockedBy).toEqual([schema.id]);
    expect(result.text).toContain(`waiting for "Queue schema"`);
  });

  it("refuses a Project that isn't there, as the user's route does, and adds nothing", async () => {
    const input = { title: "Retry", projectId: UNKNOWN_PROJECT };

    const tool = await call(ADD_TASK_ACTION.name, { initiativeId: initiative.id, ...input });
    const route = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, input);

    expect(tool.isError).toBe(true);
    expect(route.status).toBe(422);
    expect(((await route.json()) as { reasons: string[] }).reasons).toContain(
      `There is no Project "${UNKNOWN_PROJECT}".`,
    );
    expect(tool.text).toContain(`There is no Project "${UNKNOWN_PROJECT}".`);
    expect((await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id)).toBe(
      undefined,
    );
  });
});

describe("change_task_title and change_task_description", () => {
  it("rewrite one of its Tasks straight away, and announce it", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    work.published.length = 0;

    const titled = await call(CHANGE_TASK_TITLE_ACTION.name, {
      taskId: queue.id,
      title: " Keep the queue ",
    });
    const described = await call(CHANGE_TASK_DESCRIPTION_ACTION.name, {
      taskId: queue.id,
      description: "Writes survive a restart.",
    });

    expect(titled.isError).toBe(false);
    expect(described.isError).toBe(false);
    expect(await work.app.get(TaskService).read(queue.id)).toMatchObject({
      title: "Keep the queue",
      description: "Writes survive a restart.",
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.title-changed", taskId: queue.id },
      { type: "task.description-changed", taskId: queue.id },
    ]);
  });

  it("refuse a missing Task and a wrong title", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");
    const missing = randomUUID();

    expect(
      (await call(CHANGE_TASK_DESCRIPTION_ACTION.name, { taskId: missing, description: "Why" }))
        .isError,
    ).toBe(true);
    expect(
      await call(CHANGE_TASK_TITLE_ACTION.name, { taskId: queue.id, title: "Two\nlines" }),
    ).toEqual({ text: "A Task's title must be one line.", isError: true });
  });
});

/** A Task of the Initiative, which is confirmed then: active. */
async function anActiveInitiativeWithATask(): Promise<Task> {
  const queue = await anInitiativeTask("Store the queue on flash");
  await work.app.get(InitiativeService).confirm(initiative.id, ANN_LEE);
  return queue;
}

describe("once the Initiative is active", () => {
  it("each shaping call is ruled no more freely than Proposal, whatever the person's Authority", async () => {
    const queue = await anActiveInitiativeWithATask();
    const inputs: [string, Record<string, unknown>][] = [
      [WRITE_INITIATIVE_OUTCOME_ACTION.name, { initiativeId: initiative.id, outcome: "Sync." }],
      [ADD_TASK_ACTION.name, { initiativeId: initiative.id, title: "Retry", projectId: "p" }],
      [
        CHOOSE_PIPELINE_ACTION.name,
        { initiativeId: initiative.id, projectId: "p", pipelineId: null },
      ],
      [CHANGE_TASK_TITLE_ACTION.name, { taskId: queue.id, title: "Keep the queue" }],
      [CHANGE_TASK_DESCRIPTION_ACTION.name, { taskId: queue.id, description: "Survives." }],
    ];

    for (const [name, input] of inputs) {
      expect([name, await floorOf(name, input)]).toEqual([name, "proposal"]);
    }
  });

  it("a shaping Initiative has no floor", async () => {
    const queue = await anInitiativeTask("Store the queue on flash");

    expect(
      await floorOf(CHANGE_TASK_TITLE_ACTION.name, { taskId: queue.id, title: "Keep" }),
    ).toBeUndefined();
    expect(
      await floorOf(WRITE_INITIATIVE_OUTCOME_ACTION.name, {
        initiativeId: initiative.id,
        outcome: "Sync.",
      }),
    ).toBeUndefined();
  });

  it("applying the drafted Proposal runs the route's handler in the user's name", async () => {
    await anActiveInitiativeWithATask();
    const registry = work.app.get(OfficeToolRegistry);
    const projectId = aProjectId();
    const input = { initiativeId: initiative.id, title: "Retry", projectId };

    const drafted = await registry.draft(ADD_TASK_ACTION.name, input);
    await registry.applyFor(ADD_TASK_ACTION.name, input, {
      user: { userId: "ann", name: "Ann Lee" },
      proposedBy: "cto",
    });
    await registry.applyFor(
      WRITE_INITIATIVE_OUTCOME_ACTION.name,
      { initiativeId: initiative.id, outcome: "Sync works." },
      { user: { userId: "ann", name: "Ann Lee" }, proposedBy: "cto" },
    );

    expect(drafted?.subject).toMatchObject({ kind: "initiative", id: initiative.id });
    const tasks = (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id);
    expect(tasks?.find(({ title }) => title === "Retry")).toMatchObject({
      state: "backlog",
      projectId,
      createdBy: { kind: "user" },
    });
    expect((await current()).outcome).toBe("Sync works.");
    expect(await work.app.get(InitiativeService).history(initiative.id)).toEqual([
      expect.objectContaining({
        field: "outcome",
        by: { kind: "user", user: { userId: "ann", name: "Ann Lee" }, proposedBy: "cto" },
      }),
    ]);
  });

  it("refuses a change of a Task past Start as the page does", async () => {
    const queue = await anActiveInitiativeWithATask();
    await work.app.get(TaskService).drop(queue.id, ANN_LEE);

    expect(
      await call(CHANGE_TASK_TITLE_ACTION.name, { taskId: queue.id, title: "Keep it" }),
    ).toEqual({ text: "A Task keeps its title once it is Done or Dropped.", isError: true });
  });
});

describe("once the Initiative is dropped", () => {
  it("refuses the outcome, keeping it", async () => {
    await work.app.get(InitiativeService).drop(initiative.id, ANN_LEE);

    const result = await call(WRITE_INITIATIVE_OUTCOME_ACTION.name, {
      initiativeId: initiative.id,
      outcome: "Sync works.",
    });

    expect(result.isError).toBe(true);
    expect((await current()).outcome).toBe("");
  });
});

describe("read_initiative", () => {
  it("reads any Initiative by its id, in a chat as anywhere", async () => {
    await call(WRITE_INITIATIVE_OUTCOME_ACTION.name, {
      initiativeId: initiative.id,
      outcome: "Writes made offline reach the server.",
    });

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
