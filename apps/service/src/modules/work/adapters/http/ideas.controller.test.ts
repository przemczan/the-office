import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ideaSchema, workRefusalSchema, type Idea, type NewIdea } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UNKNOWN_PROJECT } from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-ideas-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  await work.app.close();
});

/** A Project id of the test's own: every test file shares the database. */
function aProjectId(): string {
  return `project-${randomUUID()}`;
}

async function capture(given: Partial<NewIdea> = {}): Promise<Idea> {
  const response = await sendJson(work, "POST", "/ideas", {
    title: "Export usage as CSV",
    notes: "",
    projectId: aProjectId(),
    ...given,
  });
  expect(response.status).toBe(201);
  return ideaSchema.parse(await response.json());
}

describe("POST /api/ideas", () => {
  it("captures an Office-wide Idea by the user, trimmed, and announces it", async () => {
    const idea = await capture({
      title: " Nightly updates ",
      notes: " Quick fix ",
      projectId: null,
    });

    expect(idea).toMatchObject({
      title: "Nightly updates",
      notes: "Quick fix",
      projectId: null,
      state: "new",
      taskId: null,
      capturedBy: { kind: "user" },
      droppedAt: null,
    });
    expect(webEventsOf(work)).toEqual([{ type: "idea.captured", ideaId: idea.id }]);
  });

  it("refuses an Idea without a title, or in a Project that isn't there, saving nothing", async () => {
    const blank = await sendJson(work, "POST", "/ideas", {
      title: " ",
      notes: "",
      projectId: null,
    });
    const unknown = await sendJson(work, "POST", "/ideas", {
      title: "Idea",
      notes: "",
      projectId: UNKNOWN_PROJECT,
    });

    expect(blank.status).toBe(422);
    expect(workRefusalSchema.parse(await blank.json()).reasons).toEqual(["Give the Idea a title."]);
    expect(unknown.status).toBe(422);
    expect(workRefusalSchema.parse(await unknown.json()).reasons).toEqual([
      `There is no Project "${UNKNOWN_PROJECT}".`,
    ]);
    expect(work.published).toEqual([]);
  });
});
