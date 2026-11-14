import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENDED_INITIATIVE_CONVERSATION_WORDS,
  ideaSchema,
  initiativeSchema,
  taskSchema,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InitiativeThreadSetups } from "../../../conversations/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { INITIATIVE_PLANNING_INSTRUCTIONS } from "../../domain/initiative-planning.js";
import { SHAPING_INSTRUCTIONS } from "../../domain/shaping.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { SHAPING_OFFICE_TOOLS, SHAPING_THREAD_INSTRUCTIONS } from "./initiative-thread-records.js";

/**
 * The Role holding Plans: its Threads on an Initiative are shaping ones unless Plan the Initiative
 * opened them.
 */
const PLANNER = "planner";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-shaping-setup-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

async function post(path: string, body?: unknown): Promise<unknown> {
  const response = await sendJson(work, "POST", path, body);
  expect(response.status).toBeLessThan(300);
  return response.json();
}

async function aTask(title: string, projectId: string): Promise<Task> {
  return taskSchema.parse(await post("/tasks", { title, projectId, priority: "normal" }));
}

async function aTaskIn(
  initiative: Initiative,
  title: string,
  projectId: string,
  blockedBy: readonly string[],
): Promise<Task> {
  return taskSchema.parse(
    await post(`/initiatives/${initiative.id}/tasks`, {
      title,
      projectId,
      priority: "normal",
      blockedBy,
    }),
  );
}

/** The setup of a session of `roleKey`'s Thread on the Initiative. */
function setUp(initiative: Initiative, roleKey: string) {
  return work.app
    .get(InitiativeThreadSetups)
    .of({ threadId: randomUUID(), initiativeId: initiative.id, roleKey });
}

/** An Initiative spanning `projectIds`, one Task in each, on the Pipeline `pipelineId` in each. */
async function anInitiativeOn(
  pipelineId: string | null,
  projectIds: readonly string[],
): Promise<{ readonly initiative: Initiative; readonly tasks: readonly Task[] }> {
  const idea = ideaSchema.parse(
    await post("/ideas", { title: `Sync ${randomUUID().slice(0, 8)}`, notes: "", projectId: null }),
  );
  let initiative = initiativeSchema.parse(await post(`/ideas/${idea.id}/initiative`));
  const tasks: Task[] = [];
  for (const projectId of projectIds) tasks.push(await aTaskIn(initiative, "Sync", projectId, []));
  for (const projectId of projectIds) {
    const response = await sendJson(work, "PUT", `/initiatives/${initiative.id}/pipeline`, {
      projectId,
      pipelineId,
    });
    expect(response.status).toBeLessThan(300);
    initiative = initiativeSchema.parse(await response.json());
  }
  return { initiative, tasks };
}

describe("a shaping Thread's session", () => {
  it("is briefed from the Initiative's record: its outcome, Tasks across Projects and what each waits for", async () => {
    const [api, web] = [`project-${randomUUID()}`, `project-${randomUUID()}`];
    const idea = ideaSchema.parse(
      await post("/ideas", { title: "Usage exports", notes: "", projectId: null }),
    );
    const initiative = initiativeSchema.parse(await post(`/ideas/${idea.id}/initiative`));
    const outside = await aTask("Billing schema", api);
    const endpoint = await aTaskIn(initiative, "Export endpoint", api, [outside.id]);
    const button = await aTaskIn(initiative, "Export button", web, [endpoint.id]);

    const setup = await work.app
      .get(InitiativeThreadSetups)
      .of({ threadId: randomUUID(), initiativeId: initiative.id, roleKey: "cto" });

    expect(setup).toEqual({
      instructions: SHAPING_THREAD_INSTRUCTIONS,
      officeTools: SHAPING_OFFICE_TOOLS,
      record: expect.any(String),
      sessionRefusal: undefined,
      branchReads: undefined,
    });
    expect(setup.record).toMatch(/^Usage exports/);
    expect(setup.record).toContain(
      [
        `Usage exports (Initiative ${initiative.id})`,
        `- shaping; spans the Project ${api}, the Project ${web}`,
        `- Shaped from: Usage exports (Idea ${idea.id}), Office-wide, shaped; read_idea reads it`,
        `- Created by the user Ann Lee on ${initiative.createdAt}`,
        `- Initiative's Pipeline in the Project ${api}: None, so each of its Tasks publishes on its own`,
        `- Initiative's Pipeline in the Project ${web}: None, so each of its Tasks publishes on its own`,
        "",
        "Outcome:",
        "Not written yet.",
        "",
        "Tasks:",
        `- Export endpoint (Task ${endpoint.id}), in the Project ${api}, Shaping; must wait for Billing schema (Task ${outside.id}, Backlog)`,
        `- Export button (Task ${button.id}), in the Project ${web}, Shaping; must wait for Export endpoint (Task ${endpoint.id}, Shaping)`,
        "",
        "Attachments:",
        "None.",
        "",
        "## Who asked",
        "",
        "The Initiative was shaped from its Idea by the user Ann Lee.",
        "",
        "## The Pipelines",
        "",
        "Each Project the Initiative spans has a Pipeline of its own, or None. Choose one for a Project with choose_pipeline, or None with null, when the user wants that Project's whole change published together; whether each Project has one is fixed at Confirm.",
        "",
        `- The ${api} (${api}): None, so each of its Tasks publishes on its own.`,
        `- The ${web} (${web}): None, so each of its Tasks publishes on its own.`,
        "",
        "- full: Full (Implement → Tests → Review & fix → Publish). For a change that needs a careful look: implement, test, review in a fresh session, publish.",
      ].join("\n"),
    );
  });

  it("is any Thread Plan the Initiative didn't open, whoever it is with, the Planner's too", async () => {
    const idea = ideaSchema.parse(
      await post("/ideas", { title: "Usage alerts", notes: "", projectId: null }),
    );
    const initiative = initiativeSchema.parse(await post(`/ideas/${idea.id}/initiative`));

    for (const roleKey of [PLANNER, "architect"]) {
      expect(await setUp(initiative, roleKey)).toMatchObject({
        instructions: SHAPING_THREAD_INSTRUCTIONS,
        officeTools: SHAPING_OFFICE_TOOLS,
      });
    }
  });

  it("is refused once the Initiative is dropped", async () => {
    const idea = ideaSchema.parse(
      await post("/ideas", { title: "Audit log", notes: "", projectId: null }),
    );
    const initiative = initiativeSchema.parse(await post(`/ideas/${idea.id}/initiative`));
    await post(`/initiatives/${initiative.id}/drop`);

    const setup = await work.app
      .get(InitiativeThreadSetups)
      .of({ threadId: randomUUID(), initiativeId: initiative.id, roleKey: "cto" });

    expect(setup.sessionRefusal).toBe(ENDED_INITIATIVE_CONVERSATION_WORDS.dropped);
  });

  it("is briefed with no Shaped from line, for the CTO and the Planner alike, for one created from no Idea", async () => {
    const name = `Single sign-on ${randomUUID().slice(0, 8)}`;
    const { initiative } = await work.app
      .get(InitiativeService)
      .create({ name, outcome: "People sign in once." }, { kind: "person", roleKey: "cto" });

    for (const roleKey of ["cto", PLANNER]) {
      const setup = await work.app
        .get(InitiativeThreadSetups)
        .of({ threadId: randomUUID(), initiativeId: initiative.id, roleKey });

      expect(setup.record).toContain(
        [
          `${name} (Initiative ${initiative.id})`,
          "- shaping; spans no Project yet",
          `- Created by the person in the Role cto on ${initiative.createdAt.toISOString()}`,
          "",
          "Outcome:",
          "People sign in once.",
        ].join("\n"),
      );
      expect(setup.record).not.toContain("Shaped from");
      expect(setup.record).not.toContain("The Idea was captured");
    }
  });
});

describe("what the Threads on an Initiative read", () => {
  it("reads the Initiative's branch in each Project it spans, once it is confirmed with a Pipeline, for the CTO and the Planner", async () => {
    const [api, web] = [`project-${randomUUID()}`, `project-${randomUUID()}`];
    const { initiative } = await anInitiativeOn("full", [api, web]);
    await post(`/initiatives/${initiative.id}/confirm`);

    const expected = {
      shortName: initiative.shortName,
      branch: `initiative/${initiative.shortName}`,
      projectIds: [api, web],
    };
    expect((await setUp(initiative, "cto")).branchReads).toEqual(expected);
    expect((await setUp(initiative, PLANNER)).branchReads).toEqual(expected);
  });

  it("reads the base branches while it is shaping, and once it is confirmed on None", async () => {
    const shaping = await anInitiativeOn("full", [`project-${randomUUID()}`]);
    const onNone = await anInitiativeOn(null, [`project-${randomUUID()}`]);
    await post(`/initiatives/${onNone.initiative.id}/confirm`);

    expect((await setUp(shaping.initiative, "cto")).branchReads).toBeUndefined();
    expect((await setUp(shaping.initiative, PLANNER)).branchReads).toBeUndefined();
    expect((await setUp(onNone.initiative, "cto")).branchReads).toBeUndefined();
    expect((await setUp(onNone.initiative, PLANNER)).branchReads).toBeUndefined();
  });

  it("reads a Project it stopped spanning at its base", async () => {
    const [api, web, app] = [
      `project-${randomUUID()}`,
      `project-${randomUUID()}`,
      `project-${randomUUID()}`,
    ];
    const { initiative, tasks } = await anInitiativeOn("full", [api, web]);
    await post(`/initiatives/${initiative.id}/confirm`);
    // Its only Task in web moves to app, where the Initiative has None (no Pipeline was fixed for
    // it at Confirm), so both web and app are read at their base branches.
    await post(`/tasks/${tasks[1]?.id ?? ""}/move`, { projectId: app });

    expect((await setUp(initiative, "cto")).branchReads?.projectIds).toEqual([api]);
  });

  it("is told to read each Project where The Projects in its Brief say, the same for every Initiative", () => {
    const reads =
      "You read each Project where The Projects in your Brief say: its base branch, or the Initiative's branch once it has one; you change no file";

    expect(SHAPING_INSTRUCTIONS).toContain(reads);
    expect(INITIATIVE_PLANNING_INSTRUCTIONS).toContain(reads);
    expect(INITIATIVE_PLANNING_INSTRUCTIONS).toContain(
      "Tell each subagent to read the Task's record and the checkouts The Projects list",
    );
  });
});
