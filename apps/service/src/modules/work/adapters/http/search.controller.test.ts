import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ideaSchema, initiativeSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { NONE_IN_OTHER_PROJECTS, searchHttp } from "../../search.controller.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** A word of this test's own, as every test file shares the database. */
let word: string;
let projectId: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-search-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  word = `zq${randomUUID().slice(0, 8)}`;
  projectId = `project-${randomUUID()}`;
});

afterEach(async () => {
  await work.app.close();
});

const { createdTask, searched, uploaded } = searchHttp(() => ({ work, projectId }));

describe("GET /search", () => {
  it("finds each kind of record with the Projects it is in", async () => {
    const task = await createdTask(`Fix the ${word} redirect`);
    const officeWide = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", {
          title: `${word} idea`,
          notes: "",
          projectId: null,
        })
      ).json(),
    );
    const shaped = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", {
          title: "An Initiative",
          notes: "",
          projectId: null,
        })
      ).json(),
    );
    const initiative = initiativeSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${shaped.id}/initiative`)).json(),
    );
    await sendJson(work, "PUT", `/initiatives/${initiative.id}/outcome`, {
      outcome: `Every ${word} lands.`,
    });
    await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
      title: "Its Task",
      projectId,
      priority: "normal",
      blockedBy: [],
    });
    const document = await uploaded(
      `/tasks/${task.id}`,
      "notes.md",
      `# Notes\n\nThe ${word} path.`,
    );

    expect(await searched(word)).toEqual({
      tasks: [
        {
          id: task.id,
          title: task.title,
          state: "backlog",
          archived: false,
          projectIds: [projectId],
        },
      ],
      ideas: [{ id: officeWide.id, title: officeWide.title, state: "new", projectIds: [] }],
      initiatives: [
        { id: initiative.id, name: "An Initiative", state: "shaping", projectIds: [projectId] },
      ],
      attachments: [
        { id: document.id, name: "notes.md", owner: document.owner, projectIds: [projectId] },
      ],
      inOtherProjects: NONE_IN_OTHER_PROJECTS,
    });
  });
});
