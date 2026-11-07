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
import { SHAPING_INSTRUCTIONS } from "../../domain/shaping.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { SHAPING_OFFICE_TOOLS } from "./shaping-thread-setup.js";

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
      instructions: SHAPING_INSTRUCTIONS,
      officeTools: SHAPING_OFFICE_TOOLS,
      record: [
        `Usage exports (Initiative ${initiative.id})`,
        `- shaping; spans the Project ${api}, the Project ${web}`,
        `- Shaped from the Idea ${idea.id} by the user on ${initiative.createdAt}`,
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
      ].join("\n"),
      sessionRefusal: undefined,
    });
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
});
