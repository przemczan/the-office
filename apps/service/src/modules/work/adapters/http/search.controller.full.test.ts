import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ideaSchema, initiativeSchema, taskListSchema, taskSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AttachmentService } from "../../application/attachment-service.js";
import type { Attachment as DomainAttachment } from "../../domain/attachment.js";
import { SEARCH_RESULT_LIMIT } from "../../domain/search.js";
import { AttachmentFiles } from "../../ports/attachment-files.js";
import { AttachmentRepository } from "../../ports/attachment-repository.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { NONE_IN_OTHER_PROJECTS, searchHttp } from "../../search.controller.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";

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

const { createdTask, boardTasks, searched, uploaded } = searchHttp(() => ({ work, projectId }));

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
  it("still finds an archived Task, marked archived", async () => {
    const task = await createdTask(`Finished ${word}`);
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);
    await sendJson(work, "POST", `/tasks/${task.id}/archive`);

    expect((await searched(word)).tasks).toEqual([
      { id: task.id, title: task.title, state: "dropped", archived: true, projectIds: [projectId] },
    ]);
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

    const nothing = {
      tasks: [],
      ideas: [],
      initiatives: [],
      attachments: [],
      inOtherProjects: NONE_IN_OTHER_PROJECTS,
    };
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

    const repository = work.app.get(AttachmentRepository);
    expect((await repository.documentsWithoutText()).map(({ id }) => id)).toContain(documentId);
    // Left in place, every later start in the run would warn about it.
    await repository.remove(documentId);
  });

  it("finds an Idea by its notes and an Initiative by its name", async () => {
    const idea = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", {
          title: "An Idea",
          notes: `Try ${word}.`,
          projectId: null,
        })
      ).json(),
    );
    const shaped = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", {
          title: `The ${word} Initiative`,
          notes: "",
          projectId: null,
        })
      ).json(),
    );
    const initiative = initiativeSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${shaped.id}/initiative`)).json(),
    );

    const { ideas, initiatives } = await searched(word);
    // The shaped Idea is found by its title, as its Initiative is by its name.
    expect(ideas.map(({ id }) => id).toSorted()).toEqual([idea.id, shaped.id].toSorted());
    expect(initiatives.map(({ id }) => id)).toEqual([initiative.id]);
  });

  it("no longer finds a document once it is removed", async () => {
    const task = await createdTask("A Task");
    const document = await uploaded(`/tasks/${task.id}`, "notes.md", `The ${word} path.`);

    await sendJson(work, "DELETE", `/attachments/${document.id}`);

    expect((await searched(word)).attachments).toEqual([]);
  });
});

describe("GET /search with the Project filter", () => {
  it("finds the matches in the Projects named and those with no Project, counting the rest", async () => {
    const shown = await createdTask(`Shown ${word}`);
    const otherProjectId = `project-${randomUUID()}`;
    await createdTask(`Elsewhere ${word}`, { projectId: otherProjectId });
    const officeWide = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", {
          title: `${word} idea`,
          notes: "",
          projectId: null,
        })
      ).json(),
    );
    await sendJson(work, "POST", "/ideas", {
      title: `${word} elsewhere`,
      notes: "",
      projectId: otherProjectId,
    });

    const found = await searched(word, [projectId]);

    expect(found.tasks.map(({ id }) => id)).toEqual([shown.id]);
    expect(found.ideas.map(({ id }) => id)).toEqual([officeWide.id]);
    expect(found.inOtherProjects).toEqual({ ...NONE_IN_OTHER_PROJECTS, tasks: 1, ideas: 1 });
    expect((await searched(word, [projectId, otherProjectId])).tasks).toHaveLength(2);
  });

  it("keeps the best matches after narrowing, so a narrow filter finds what ranks below others", async () => {
    const otherProjectId = `project-${randomUUID()}`;
    const elsewhere = SEARCH_RESULT_LIMIT + 1;
    for (let index = 0; index < elsewhere; index++) {
      await createdTask(`${word} elsewhere ${index}`, { projectId: otherProjectId });
    }
    // Matched only in its Plan, it ranks below every title match.
    const planned = await createdTask("Planned");
    await sendJson(work, "PUT", `/tasks/${planned.id}/plan`, { plan: `Keep ${word}.` });

    const found = await searched(word, [projectId]);

    expect(found.tasks.map(({ id }) => id)).toEqual([planned.id]);
    expect(found.inOtherProjects.tasks).toBe(elsewhere);
    expect((await searched(word)).tasks).toHaveLength(SEARCH_RESULT_LIMIT);
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
    text: true,
    sourcePath: undefined,
    addedBy: ANN_LEE,
    addedAt: new Date(),
  };
}
