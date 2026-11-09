import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPTURE_IDEA_TOOL } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import {
  IdeaCardsForTests,
  UNKNOWN_PROJECT,
  UNKNOWN_SESSION,
} from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { CREATE_TASK, LIST_IDEAS, LIST_TASKS, READ_IDEA, READ_TASK } from "./work-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The test's own Project: every test file shares the database. */
let projectId: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-work-tools-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  projectId = `project-${randomUUID()}`;
});

afterEach(async () => {
  await work.app.close();
});

/** Calls the Office tool as a chat session of the Planner would. */
function call(name: string, input: Record<string, unknown>, sessionId = "planner-session") {
  const [tool] = work.app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, anOfficeToolCall(sessionId));
}

describe("capture_idea", () => {
  it("captures an Idea in the name of the person in the session", async () => {
    const result = await call(CAPTURE_IDEA_TOOL, {
      title: "Export usage as CSV",
      notes: "For the accountant.",
      projectId,
    });

    expect(result.isError).toBe(false);
    const [idea] = (await work.app.get(IdeaService).list()).filter(
      (candidate) => candidate.projectId === projectId,
    );
    expect(idea).toMatchObject({
      title: "Export usage as CSV",
      notes: "For the accountant.",
      state: "new",
      capturedBy: { kind: "person", roleKey: "planner" },
    });
    expect(result.text).toBe(
      `Captured the Idea "Export usage as CSV" (Idea ${idea?.id}), in the Project ${projectId}. Its card is in this chat, for the user to plan it from.`,
    );
  });

  it("posts the Idea's card in the chat it was captured in", async () => {
    await call(CAPTURE_IDEA_TOOL, { title: "Weekly usage summary", projectId });

    const [idea] = (await work.app.get(IdeaService).list()).filter(
      (candidate) => candidate.projectId === projectId,
    );
    expect(work.app.get(IdeaCardsForTests).posted).toEqual([
      { sessionId: "planner-session", ideaId: idea?.id },
    ]);
  });

  it("captures one Office-wide, and refuses one without a title with the reason", async () => {
    const officeWide = await call(CAPTURE_IDEA_TOOL, { title: "Nightly updates" });
    const blank = await call(CAPTURE_IDEA_TOOL, { title: " " });

    expect(officeWide.text).toMatch(
      /^Captured the Idea "Nightly updates" \(Idea .+\), Office-wide\. Its card/,
    );
    expect(blank).toEqual({ text: "Give the Idea a title.", isError: true });
  });

  it("refuses a session nobody keeps, with no card", async () => {
    const result = await call(CAPTURE_IDEA_TOOL, { title: "Anything" }, UNKNOWN_SESSION);

    expect(result).toEqual({
      text: "The Office doesn't know whose session this is.",
      isError: true,
    });
    expect(work.app.get(IdeaCardsForTests).posted).toEqual([]);
  });
});

describe("create_task", () => {
  it("creates a Task in Backlog in the person's name, on the Project's default Pipeline", async () => {
    const result = await call(CREATE_TASK, { title: "Fix the login redirect", projectId });

    const [task] = (await work.app.get(TaskService).list()).filter(
      (candidate) => candidate.projectId === projectId,
    );
    expect(task).toMatchObject({
      title: "Fix the login redirect",
      description: "",
      state: "backlog",
      priority: "normal",
      pipelineId: "quick-fix",
      createdBy: { kind: "person", roleKey: "planner" },
    });
    expect(result).toEqual({
      text: `Created the Task "Fix the login redirect" (Task ${task?.id}) in Backlog in ${projectId}, on the Pipeline quick-fix.`,
      isError: false,
    });
  });

  it("saves the Description the person gives, trimmed", async () => {
    await call(CREATE_TASK, {
      title: "Remember the last Project",
      description: "  The Add Task form should start on the Project I used last.\n",
      projectId,
    });

    const task = (await work.app.get(TaskService).list()).find(
      (candidate) => candidate.title === "Remember the last Project",
    );
    expect(task?.description).toBe("The Add Task form should start on the Project I used last.");
  });

  it("refuses a Project The Office doesn't know, with every reason", async () => {
    const result = await call(CREATE_TASK, { title: "", projectId: UNKNOWN_PROJECT });

    expect(result).toEqual({
      text: `Give the Task a title. There is no Project "${UNKNOWN_PROJECT}".`,
      isError: true,
    });
  });
});

describe("reading Tasks and Ideas", () => {
  it("lists a Project's Tasks and reads one's record with its Attachments", async () => {
    const tasks = work.app.get(TaskService);
    const task = await tasks.create(
      { title: "Fix the login redirect", projectId, priority: "high" },
      THE_USER,
    );
    await tasks.create(
      { title: "Elsewhere", projectId: `project-${randomUUID()}`, priority: "normal" },
      THE_USER,
    );
    await work.app
      .get(AttachmentService)
      .addLink(
        { kind: "task", taskId: task.id },
        { name: "Spec", url: "https://example.com/spec" },
        THE_USER,
      );

    const list = await call(LIST_TASKS, { projectId });
    const record = await call(READ_TASK, { taskId: task.id });

    expect(list.text).toBe(
      `- Fix the login redirect (Task ${task.id}) · Project ${projectId} · Backlog · high priority`,
    );
    expect(record.text).toContain(`Fix the login redirect (Task ${task.id})`);
    expect(record.text).toContain("Plan:\nNo Plan yet.");
    expect(record.text).toContain("Definition of Done:\nNot written yet.");
    expect(record.text).toContain("Attachments:\n- Spec (link to https://example.com/spec)");
  });

  it("leaves an archived Task out of the list, and reads its record saying it is archived", async () => {
    const tasks = work.app.get(TaskService);
    const onBoard = await tasks.create(
      { title: "On the board", projectId, priority: "normal" },
      THE_USER,
    );
    const finished = await tasks.create(
      { title: "Finished", projectId, priority: "normal" },
      THE_USER,
    );
    await tasks.drop(finished.id);
    const archived = await tasks.archive(finished.id);

    const list = await call(LIST_TASKS, { projectId });
    const record = await call(READ_TASK, { taskId: finished.id });

    expect(list.text).toBe(
      `- On the board (Task ${onBoard.id}) · Project ${projectId} · Backlog · normal priority`,
    );
    expect(record.text).toContain(
      `- Archived on ${archived.archivedAt?.toISOString()}: off the board, its state as it was`,
    );
  });

  it("lists the Ideas and reads one's record", async () => {
    const idea = await work.app
      .get(IdeaService)
      .capture({ title: "Voice notes", notes: "From the phone.", projectId: undefined }, THE_USER);

    const list = await call(LIST_IDEAS, {});
    const record = await call(READ_IDEA, { ideaId: idea.id });

    expect(list.text).toContain(`- Voice notes (Idea ${idea.id}) · Office-wide · new`);
    expect(record.text).toContain("- Office-wide; new");
    expect(record.text).toContain("- Captured by the user on");
    expect(record.text).toContain("Notes:\nFrom the phone.");
  });

  it("answers a Task or an Idea that isn't there as an error the person can read", async () => {
    const missing = randomUUID();

    await expect(call(READ_TASK, { taskId: missing })).resolves.toEqual({
      text: `There is no Task "${missing}".`,
      isError: true,
    });
    await expect(call(READ_IDEA, { ideaId: missing })).resolves.toEqual({
      text: `There is no Idea "${missing}".`,
      isError: true,
    });
  });
});
