import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentSchema,
  ideaSchema,
  initiativeSchema,
  searchResultsSchema,
  taskListSchema,
  taskSchema,
  type Attachment,
  type SearchResults,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AttachmentService } from "../../application/attachment-service.js";
import type { Attachment as DomainAttachment } from "../../domain/attachment.js";
import { THE_USER } from "../../domain/author.js";
import { AttachmentFiles } from "../../ports/attachment-files.js";
import { AttachmentRepository } from "../../ports/attachment-repository.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

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

async function createdTask(title: string, fields: object = {}): Promise<Task> {
  const response = await sendJson(work, "POST", "/tasks", {
    title,
    projectId,
    priority: "normal",
    ...fields,
  });
  return taskSchema.parse(await response.json());
}

async function boardTasks(query: string): Promise<string[]> {
  const response = await fetch(`${work.url}/api/tasks?${new URLSearchParams({ query })}`);
  expect(response.status).toBe(200);
  return taskListSchema.parse(await response.json()).map(({ title }) => title);
}

async function searched(query: string): Promise<SearchResults> {
  const response = await fetch(`${work.url}/api/search?${new URLSearchParams({ query })}`);
  expect(response.status).toBe(200);
  return searchResultsSchema.parse(await response.json());
}

async function uploaded(path: string, name: string, content: string): Promise<Attachment> {
  const query = new URLSearchParams({ fileName: name, mediaType: "text/markdown" });
  const response = await fetch(`${work.url}/api${path}/attachments/files?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new TextEncoder().encode(content),
  });
  expect(response.status).toBe(201);
  return attachmentSchema.parse(await response.json());
}

describe("GET /tasks with a query", () => {
  it("finds a Task by its title, Plan, Definition of Done and Tags, by the start of a word", async () => {
    await createdTask(`By title ${word}`);
    const planned = await createdTask("By Plan");
    await sendJson(work, "PUT", `/tasks/${planned.id}/plan`, { plan: `Keep ${word}suffix.` });
    const done = await createdTask("By Definition of Done");
    await sendJson(work, "PUT", `/tasks/${done.id}/definition-of-done`, {
      definitionOfDone: [`The ${word} works.`],
    });
    await createdTask("By Tag", { tags: [`${word}-polish`] });
    await createdTask("Not this one");

    expect(await boardTasks(word.slice(0, 10))).toEqual([
      `By title ${word}`,
      "By Plan",
      "By Definition of Done",
      "By Tag",
    ]);
  });

  it("needs every word, and finds a part of a hyphenated Tag", async () => {
    await createdTask("Tagged", { tags: [`${word}-polish`] });
    await createdTask(`Untagged ${word}`);

    expect(await boardTasks(`${word} POLISH`)).toEqual(["Tagged"]);
  });

  it("answers every Task in the board's order without words", async () => {
    const first = await createdTask(`First ${word}`);
    const second = await createdTask(`Second ${word}`);

    const response = await fetch(`${work.url}/api/tasks?query=${encodeURIComponent(" & ")}`);
    const ids = taskListSchema.parse(await response.json()).map(({ id }) => id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });
});

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
      tasks: [{ id: task.id, title: task.title, state: "backlog", projectIds: [projectId] }],
      ideas: [{ id: officeWide.id, title: officeWide.title, state: "new", projectIds: [] }],
      initiatives: [
        { id: initiative.id, name: "An Initiative", state: "shaping", projectIds: [projectId] },
      ],
      attachments: [
        { id: document.id, name: "notes.md", owner: document.owner, projectIds: [projectId] },
      ],
    });
  });

  it("finds a document by its name and text, and no other kind of Attachment", async () => {
    const task = await createdTask("A Task");
    const byName = await uploaded(`/tasks/${task.id}`, `${word}-brief.md`, "Nothing else.");
    const byText = await uploaded(`/tasks/${task.id}`, "brief.md", `Read ${word}.`);
    await uploaded(`/tasks/${task.id}`, `${word}.txt`, `Read ${word}.`);

    const { attachments } = await searched(`brief ${word}`);
    expect(attachments.map(({ id }) => id).toSorted()).toEqual([byName.id, byText.id].toSorted());
  });

  it("keeps a document's text when it moves with its Idea", async () => {
    const idea = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", { title: "Shaped", notes: "", projectId: null })
      ).json(),
    );
    const document = await uploaded(`/ideas/${idea.id}`, "notes.md", `The ${word} path.`);
    const task = taskSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${idea.id}/shape`, { projectId })).json(),
    );

    expect((await searched(word)).attachments).toEqual([
      {
        id: document.id,
        name: "notes.md",
        owner: { kind: "task", taskId: task.id },
        projectIds: [projectId],
      },
    ]);
  });

  it("finds nothing for no words, and reads query syntax as separators", async () => {
    await createdTask(`A ${word}`);

    const nothing = { tasks: [], ideas: [], initiatives: [], attachments: [] };
    expect(await searched("")).toEqual(nothing);
    expect((await searched(`!(${word}):* | &`)).tasks).toHaveLength(1);
  });

  it("finds the documents added before their text was kept, once their text is filled", async () => {
    const task = await createdTask("A Task");
    const documentId = randomUUID();
    await work.app.get(AttachmentFiles).save(documentId, new TextEncoder().encode(`Old ${word}.`));
    await work.app.get(AttachmentRepository).add(anOldDocument(documentId, task.id));
    expect((await searched(word)).attachments).toEqual([]);

    await work.app.get(AttachmentService).fillDocumentTexts();

    expect((await searched(word)).attachments.map(({ id }) => id)).toEqual([documentId]);
    const unfilled = await work.app.get(AttachmentRepository).documentsWithoutText();
    expect(unfilled.map(({ id }) => id)).not.toContain(documentId);
  });

  it("leaves a document whose file can't be read without text, to read it at the next start", async () => {
    const task = await createdTask("A Task");
    const documentId = randomUUID();
    await work.app.get(AttachmentRepository).add(anOldDocument(documentId, task.id));

    await work.app.get(AttachmentService).fillDocumentTexts();

    const unfilled = await work.app.get(AttachmentRepository).documentsWithoutText();
    expect(unfilled.map(({ id }) => id)).toContain(documentId);
  });
});

/** A document as one was added before the search kept documents' text. */
function anOldDocument(id: string, taskId: string): DomainAttachment {
  return {
    id,
    owner: { kind: "task", taskId },
    kind: "document",
    name: "old.md",
    mediaType: "text/markdown",
    size: 10,
    addedBy: THE_USER,
    addedAt: new Date(),
  };
}
