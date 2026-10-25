import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import { PLANNING_OFFICE_TOOLS } from "../../domain/planning.js";
import type { Task } from "../../domain/task.js";
import { SessionTasksForTests } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import {
  DOCUMENT_READ_LIMIT,
  PROPOSE_PIPELINE,
  READ_ATTACHMENT,
  WRITE_DEFINITION_OF_DONE,
  WRITE_PLAN,
} from "./planning-office-tools.js";

let officeData: string;
let work: WorkApplication;
/** The planning session's Task, in Planning. */
let task: Task;

const SESSION = "planning-session";
const CHAT_SESSION = "chat-session";

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-planning-tools-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  task = await aTaskInPlanning();
  work.app.get(SessionTasksForTests).tasks.set(SESSION, task.id);
});

afterEach(async () => {
  await work.app.close();
});

async function aTaskInPlanning(): Promise<Task> {
  const created = await work.app
    .get(TaskService)
    .create(
      { title: "Fix the login redirect", projectId: `project-${randomUUID()}`, priority: "normal" },
      THE_USER,
    );
  return work.app.get(PlanningService).plan(created.id);
}

/** Calls the Office tool as the Planner's session on the Task would. */
function call(name: string, input: Record<string, unknown>, sessionId = SESSION) {
  const [tool] = work.app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, { sessionId });
}

function current(): Promise<Task> {
  return work.app.get(TaskService).read(task.id);
}

it("are among a planning session's Office tools", () => {
  expect(PLANNING_OFFICE_TOOLS).toEqual(
    expect.arrayContaining([
      WRITE_PLAN,
      WRITE_DEFINITION_OF_DONE,
      PROPOSE_PIPELINE,
      READ_ATTACHMENT,
    ]),
  );
});

describe("write_plan", () => {
  it("writes the Plan onto the session's Task as proposed", async () => {
    const result = await call(WRITE_PLAN, { plan: "Keep the requested path through the sign-in." });

    expect(result).toEqual({
      text: "Wrote the Plan onto the Task. It shows on the Task as proposed until the user confirms or edits it; end your turn when you want them to look at it.",
      isError: false,
    });
    expect(await current()).toMatchObject({
      plan: "Keep the requested path through the sign-in.",
      planConfirmed: false,
    });
  });

  it("refuses a session on no Task, and a Task past Planning, with the reason", async () => {
    const chat = await call(WRITE_PLAN, { plan: "Anything." }, CHAT_SESSION);
    await work.app.get(TaskService).drop(task.id);
    const dropped = await call(WRITE_PLAN, { plan: "Anything." });

    expect(chat).toEqual({
      text: "This tool works in a Thread on a Task, and this session is on none.",
      isError: true,
    });
    expect(dropped).toEqual({
      text: "The Plan is proposed while the Task is in Planning; this one is in Dropped.",
      isError: true,
    });
  });
});

describe("write_definition_of_done", () => {
  it("writes the statements onto the Task as proposed", async () => {
    const result = await call(WRITE_DEFINITION_OF_DONE, {
      statements: ["Signing in returns to the page asked for.", "No redirect loop."],
    });

    expect(result.isError).toBe(false);
    expect(await current()).toMatchObject({
      definitionOfDone: ["Signing in returns to the page asked for.", "No redirect loop."],
      definitionOfDoneConfirmed: false,
    });
  });

  it("refuses none, with the reason", async () => {
    await expect(call(WRITE_DEFINITION_OF_DONE, { statements: [] })).resolves.toEqual({
      text: "A Definition of Done needs at least one statement.",
      isError: true,
    });
  });
});

describe("propose_pipeline", () => {
  it("proposes a Pipeline beside the one the Task follows until the user confirms it", async () => {
    const result = await call(PROPOSE_PIPELINE, { pipelineId: "full", why: "It changes code." });

    expect(result).toEqual({
      text: "Proposed the Pipeline full. The Task follows it once the user confirms it.",
      isError: false,
    });
    expect(await current()).toMatchObject({
      pipelineId: "quick-fix",
      proposedPipeline: { pipelineId: "full", reason: "It changes code." },
    });
  });

  it("refuses a Pipeline the library doesn't have, naming those it has", async () => {
    await expect(call(PROPOSE_PIPELINE, { pipelineId: "nightly", why: "No." })).resolves.toEqual({
      text: 'There is no Pipeline "nightly". The library has full, quick-fix, document.',
      isError: true,
    });
  });
});

/** Attaches a file to the session's Task, or to another. */
function addFile(name: string, mediaType: string, content: string, taskId = task.id) {
  return work.app
    .get(AttachmentService)
    .addFile(
      { kind: "task", taskId },
      { name, mediaType, content: new TextEncoder().encode(content) },
      THE_USER,
    );
}

describe("read_attachment", () => {
  it("reads a document's text", async () => {
    const notes = await addFile("notes.md", "text/markdown", "# Notes\n\nKeep the path.");

    await expect(call(READ_ATTACHMENT, { attachmentId: notes.id })).resolves.toEqual({
      text: "notes.md (document, text/markdown, 23 bytes):\n\n# Notes\n\nKeep the path.",
      isError: false,
    });
  });

  it("reads the start of a long document, saying it goes on", async () => {
    const long = await addFile("long.md", "text/markdown", "é".repeat(DOCUMENT_READ_LIMIT));

    const result = await call(READ_ATTACHMENT, { attachmentId: long.id });

    // Two bytes a character, so the limit holds half of them, and no half character at its end.
    expect(result.text).toBe(
      `long.md (document, text/markdown, ${DOCUMENT_READ_LIMIT * 2} bytes):\n\n${"é".repeat(DOCUMENT_READ_LIMIT / 2)}\n\nThe document goes on: these are its first ${DOCUMENT_READ_LIMIT} bytes.`,
    );
  });

  it("gives a link's address and an image's name and kind", async () => {
    const link = await work.app
      .get(AttachmentService)
      .addLink(
        { kind: "task", taskId: task.id },
        { name: "Spec", url: "https://example.com/spec" },
        THE_USER,
      );
    const image = await addFile("screen.png", "image/png", "png bytes");

    const linkRead = await call(READ_ATTACHMENT, { attachmentId: link.id });
    const imageRead = await call(READ_ATTACHMENT, { attachmentId: image.id });

    expect(linkRead.text).toBe(
      "Spec (link to https://example.com/spec). The Office keeps its address only; fetch it if you need what it says.",
    );
    expect(imageRead.text).toBe(
      "screen.png (image, image/png, 9 bytes). Only a document is read as text; ask the user what it holds if you need to know.",
    );
  });

  it("refuses another Task's Attachment as one it doesn't have", async () => {
    const other = await aTaskInPlanning();
    const elsewhere = await addFile("other.md", "text/markdown", "Not yours.", other.id);

    await expect(call(READ_ATTACHMENT, { attachmentId: elsewhere.id })).resolves.toEqual({
      text: `There is no Attachment "${elsewhere.id}".`,
      isError: true,
    });
  });
});
