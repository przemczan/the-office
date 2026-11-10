import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPTURE_IDEA_TOOL } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import type { AttachmentOwner } from "../../domain/attachment.js";
import { THE_USER } from "../../domain/author.js";
import {
  IdeaCardsForTests,
  UNKNOWN_PROJECT,
  UNKNOWN_SESSION,
} from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { READ_INITIATIVE } from "./shaping-office-tools.js";
import {
  CREATE_TASK,
  DOCUMENT_ANSWER_BUDGET,
  LIST_IDEAS,
  LIST_TASKS,
  READ_ATTACHMENT,
  READ_IDEA,
  READ_TASK,
} from "./work-office-tools.js";
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

  it("takes an optional Plan, with its files and estimate, and an optional Definition of Done", () => {
    const [tool] = work.app.get(OfficeToolRegistry).named([CREATE_TASK]);
    const schema = z.toJSONSchema(tool!.input) as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["plan", "filesToChange", "estimatedTokens", "definitionOfDone"]),
    );
    expect(schema.required.toSorted()).toEqual(["projectId", "title"]);
  });

  it("creates a Task with both parts, Not confirmed, created by the person in the session", async () => {
    const result = await call(CREATE_TASK, {
      title: "Rename the Save button",
      projectId,
      plan: "  Rename it in the editor.\n",
      filesToChange: ["./apps/web/src/editor.tsx"],
      estimatedTokens: 40_000,
      definitionOfDone: [" The button reads Keep. ", "The e2e test passes."],
    });

    const [task] = (await work.app.get(TaskService).list()).filter(
      (candidate) => candidate.projectId === projectId,
    );
    expect(task).toMatchObject({
      state: "backlog",
      plan: "Rename it in the editor.",
      filesToChange: ["apps/web/src/editor.tsx"],
      estimatedTokens: 40_000,
      planConfirmed: false,
      definitionOfDone: ["The button reads Keep.", "The e2e test passes."],
      definitionOfDoneConfirmed: false,
      createdBy: { kind: "person", roleKey: "planner" },
    });
    expect(result).toEqual({
      text: `Created the Task "Rename the Save button" (Task ${task?.id}) in Backlog in ${projectId}, on the Pipeline quick-fix. Its Plan and Definition of Done are Not confirmed until the user confirms each on the Task page.`,
      isError: false,
    });
    expect(await work.app.get(TaskRecords).recordText(task!.id)).toContain(
      "created in Backlog, by the person in the Role planner",
    );
  });

  it.each([
    ["a Plan alone", { plan: "Do it." }, HALF_A_PAIR],
    ["a Definition of Done alone", { definitionOfDone: ["It is done."] }, HALF_A_PAIR],
    [
      "files to change without a Plan",
      { filesToChange: ["src"] },
      "Files to change and a token estimate are part of the Plan: give them only with a Plan.",
    ],
    [
      "an estimate with a Definition of Done but no Plan",
      { estimatedTokens: 1_000, definitionOfDone: ["It is done."] },
      `${HALF_A_PAIR} Files to change and a token estimate are part of the Plan: give them only with a Plan.`,
    ],
  ])("refuses %s with the reason, and creates no Task", async (_case, parts, reason) => {
    const result = await call(CREATE_TASK, { title: "Half planned", projectId, ...parts });

    expect(result).toEqual({ text: reason, isError: true });
    expect(
      (await work.app.get(TaskService).list()).filter(
        (candidate) => candidate.projectId === projectId,
      ),
    ).toEqual([]);
  });

  it("refuses an empty Plan or statement with every reason, and creates no Task", async () => {
    const result = await call(CREATE_TASK, {
      title: "Planned badly",
      projectId,
      plan: " ",
      definitionOfDone: ["It works.", " "],
    });

    expect(result).toEqual({
      text: "The Plan can't be empty. A statement of the Definition of Done can't be empty.",
      isError: true,
    });
    expect(
      (await work.app.get(TaskService).list()).filter(
        (candidate) => candidate.projectId === projectId,
      ),
    ).toEqual([]);
  });
});

const HALF_A_PAIR =
  "Give both the Plan and the Definition of Done, or neither: Ready needs both, so one alone helps nobody.";

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

/** Attaches a document to its owner. */
function addDocument(owner: AttachmentOwner, name: string, content: string) {
  return work.app
    .get(AttachmentService)
    .addFile(
      owner,
      { name, mediaType: "text/markdown", content: new TextEncoder().encode(content) },
      THE_USER,
    );
}

/** The fromLine an answer's last words say to read or search on with, if it goes on. */
function fromLineToGoOn(goOn: "Read on" | "Search on", answer: string): string | undefined {
  return new RegExp(`${goOn} with fromLine (\\d+)\\.$`).exec(answer)?.[1];
}

function aTaskNamed(title: string) {
  return work.app.get(TaskService).create({ title, projectId, priority: "normal" }, THE_USER);
}

describe("read_attachment", () => {
  it("reads any Task's document, in a session on no Task, naming the Task it belongs to", async () => {
    const other = await aTaskNamed("Add the session store");
    const notes = await addDocument({ kind: "task", taskId: other.id }, "notes.md", "# Notes");

    await expect(
      call(READ_ATTACHMENT, { attachmentId: notes.id }, "chat-on-no-task"),
    ).resolves.toEqual({
      text: `Attached to Task ${other.id}: Add the session store.\n\nnotes.md (document, text/markdown, 7 bytes), 1 line:\n\n     1→# Notes\n\nLine 1 of 1: the end of the document.`,
      isError: false,
    });
  });

  it("reads an archived Task's document, saying the Task is archived", async () => {
    const tasks = work.app.get(TaskService);
    const finished = await aTaskNamed("Finished");
    const notes = await addDocument({ kind: "task", taskId: finished.id }, "notes.md", "Done.");
    await tasks.drop(finished.id);
    await tasks.archive(finished.id);

    const result = await call(READ_ATTACHMENT, { attachmentId: notes.id });

    expect(result.text).toBe(
      `Attached to Task ${finished.id}: Finished (archived).\n\nnotes.md (document, text/markdown, 5 bytes), 1 line:\n\n     1→Done.\n\nLine 1 of 1: the end of the document.`,
    );
  });

  it("reads an Idea's and an Initiative's document, naming each owner", async () => {
    const ideas = work.app.get(IdeaService);
    const idea = await ideas.capture(
      { title: "Voice notes", notes: "", projectId: undefined },
      THE_USER,
    );
    const ideaNotes = await addDocument({ kind: "idea", ideaId: idea.id }, "idea.md", "Idea.");
    const origin = await ideas.capture(
      { title: "Usage exports", notes: "", projectId: undefined },
      THE_USER,
    );
    const initiative = await work.app.get(InitiativeService).shape(origin.id, THE_USER);
    const outcome = await addDocument(
      { kind: "initiative", initiativeId: initiative.id },
      "outcome.md",
      "Outcome.",
    );

    const ideaRead = await call(READ_ATTACHMENT, { attachmentId: ideaNotes.id });
    const initiativeRead = await call(READ_ATTACHMENT, { attachmentId: outcome.id });

    expect(ideaRead.text).toBe(
      `Attached to Idea ${idea.id}: Voice notes.\n\nidea.md (document, text/markdown, 5 bytes), 1 line:\n\n     1→Idea.\n\nLine 1 of 1: the end of the document.`,
    );
    expect(initiativeRead.text).toBe(
      `Attached to Initiative ${initiative.id}: ${initiative.name}.\n\noutcome.md (document, text/markdown, 8 bytes), 1 line:\n\n     1→Outcome.\n\nLine 1 of 1: the end of the document.`,
    );
  });

  it("reads a slice of a document by its lines, saying where it goes on", async () => {
    const task = await aTaskNamed("Notes");
    const notes = await addDocument(
      { kind: "task", taskId: task.id },
      "notes.md",
      "one\r\ntwo\r\nthree\r\nfour\r\n",
    );

    const result = await call(READ_ATTACHMENT, {
      attachmentId: notes.id,
      fromLine: 2,
      lineCount: 2,
    });

    expect(result.text).toBe(
      `Attached to Task ${task.id}: Notes.\n\nnotes.md (document, text/markdown, 23 bytes), 4 lines:\n\n     2→two\n     3→three\n\nLines 2–3 of 4. Read on with fromLine 4.`,
    );
  });

  it("searches a document for a phrase, with the lines around each match", async () => {
    const task = await aTaskNamed("Notes");
    const notes = await addDocument(
      { kind: "task", taskId: task.id },
      "notes.md",
      ["Intro", "The Z 7II downloads RAW.", "Middle", "Gap", "Gap", "Gap", "raw again", "End"].join(
        "\n",
      ),
    );

    const result = await call(READ_ATTACHMENT, {
      attachmentId: notes.id,
      search: "RAW",
      contextLines: 1,
    });

    expect(result.text).toBe(
      [
        `Attached to Task ${task.id}: Notes.\n\nnotes.md (document, text/markdown, 63 bytes), 8 lines:\n`,
        "     1-Intro",
        "     2:The Z 7II downloads RAW.",
        "     3-Middle",
        "--",
        "     6-Gap",
        "     7:raw again",
        "     8-End",
        "",
        "2 matches shown, up to line 7; none after it: the search reached the end of the document.",
      ].join("\n"),
    );
  });

  it("reads a document far larger than an answer in slices and searches, each within the budget", async () => {
    const task = await aTaskNamed("Long report");
    const lines = Array.from(
      { length: 3_000 },
      (_, index) =>
        `Line ${index + 1} of the report, about cameras on USB${index % 100 === 0 ? " and PTP" : ""}.`,
    );
    const report = await addDocument(
      { kind: "task", taskId: task.id },
      "report.md",
      lines.join("\n"),
    );
    expect(report.kind === "document" && report.size).toBeGreaterThan(100_000);

    const read = async (input: Record<string, unknown>) => {
      const { text, isError } = await call(READ_ATTACHMENT, { attachmentId: report.id, ...input });
      expect(isError).toBe(false);
      expect(text.length).toBeLessThanOrEqual(DOCUMENT_ANSWER_BUDGET);
      expect(text).toContain("3,000 lines:");
      return text;
    };

    // Read by its id alone, the start; then on from where each answer says, to the end.
    let text = await read({});
    expect(text).toContain("     1→Line 1 of the report");
    let readOn = fromLineToGoOn("Read on", text);
    const slices = [text];
    while (readOn !== undefined) {
      text = await read({ fromLine: Number(readOn), lineCount: 1_000 });
      expect(text).toContain(`${readOn.padStart(6)}→Line ${readOn} of the report`);
      slices.push(text);
      readOn = fromLineToGoOn("Read on", text);
    }
    expect(slices.length).toBeGreaterThan(3);
    expect(text).toMatch(/–3000 of 3,000: the end of the document\.$/);

    // A search pages the same way, and a match's line number starts a slice at that line.
    const search = await read({ search: "and ptp" });
    expect(search).toContain("  2901:Line 2901 of the report");
    expect(search).toMatch(/30 matches shown, up to line 2901; none after it/);
    const fromMatch = await read({ fromLine: 2901, lineCount: 1 });
    expect(fromMatch).toContain("  2901→Line 2901 of the report, about cameras on USB and PTP.");

    const everyLine = await read({ search: "the report" });
    const searchOn = fromLineToGoOn("Search on", everyLine) ?? "";
    expect(searchOn).not.toBe("");
    const next = await read({ search: "the report", fromLine: Number(searchOn) });
    expect(next).toContain(`${searchOn.padStart(6)}:Line ${searchOn} of the report`);
  });

  it("cuts a line longer than an answer can hold, saying so", async () => {
    const task = await aTaskNamed("Minified");
    const minified = await addDocument(
      { kind: "task", taskId: task.id },
      "minified.md",
      `${"é".repeat(DOCUMENT_ANSWER_BUDGET * 2)}\n{}`,
    );

    const { text } = await call(READ_ATTACHMENT, { attachmentId: minified.id });

    expect(text.length).toBeLessThanOrEqual(DOCUMENT_ANSWER_BUDGET);
    expect(text).toMatch(
      /Line 1 of 2; one answer holds no more\. Read on with fromLine 2\. Line 1 is longer than one answer can hold, so it is cut: these are its first [\d,]+ of 50,000 characters\.$/,
    );
  });

  it("gives a link's address and an image's and other file's name and kind", async () => {
    const task = await aTaskNamed("Mockups");
    const attachments = work.app.get(AttachmentService);
    const link = await attachments.addLink(
      { kind: "task", taskId: task.id },
      { name: "Spec", url: "https://example.com/spec" },
      THE_USER,
    );
    const image = await attachments.addFile(
      { kind: "task", taskId: task.id },
      {
        name: "screen.png",
        mediaType: "image/png",
        content: new TextEncoder().encode("png bytes"),
      },
      THE_USER,
    );

    const archive = await attachments.addFile(
      { kind: "task", taskId: task.id },
      { name: "export.zip", mediaType: "application/zip", content: new Uint8Array([80, 75]) },
      THE_USER,
    );

    const linkRead = await call(READ_ATTACHMENT, { attachmentId: link.id });
    const imageRead = await call(READ_ATTACHMENT, { attachmentId: image.id, search: "png" });
    const fileRead = await call(READ_ATTACHMENT, { attachmentId: archive.id, fromLine: 5 });

    expect(linkRead.text).toBe(
      `Attached to Task ${task.id}: Mockups.\n\nSpec (link to https://example.com/spec). The Office keeps its address only; fetch it if you need what it says.`,
    );
    expect(imageRead.text).toBe(
      `Attached to Task ${task.id}: Mockups.\n\nscreen.png (image, image/png, 9 bytes). Only a document is read as text; ask the user what it holds if you need to know.`,
    );
    expect(fileRead.text).toBe(
      `Attached to Task ${task.id}: Mockups.\n\nexport.zip (file, application/zip, 2 bytes). Only a document is read as text; ask the user what it holds if you need to know.`,
    );
  });

  it("refuses an Attachment that isn't there", async () => {
    const missing = randomUUID();

    await expect(call(READ_ATTACHMENT, { attachmentId: missing })).resolves.toEqual({
      text: `There is no Attachment "${missing}".`,
      isError: true,
    });
  });
});

describe("linked records", () => {
  it("read_task names the Tasks it waits for and that wait for it, archived and dropped ones marked", async () => {
    const tasks = work.app.get(TaskService);
    const blocker = await aTaskNamed("Add the session store");
    const dropped = await aTaskNamed("Old approach");
    const task = await aTaskNamed("Remember me");
    const waiting = await aTaskNamed("Sign out everywhere");
    await tasks.addDependency(task.id, blocker.id);
    await tasks.addDependency(task.id, dropped.id);
    await tasks.addDependency(waiting.id, task.id);
    await tasks.drop(dropped.id);
    await tasks.archive(dropped.id);

    const record = await call(READ_TASK, { taskId: task.id });

    expect(record.text).toContain(
      [
        "Linked records:",
        `- Waits for: Add the session store (Task ${blocker.id}), Backlog; read_task reads it`,
        `- Waits for: Old approach (Task ${dropped.id}), Dropped, so it no longer blocks, archived; read_task reads it`,
        `- Waiting for it: Sign out everywhere (Task ${waiting.id}), Backlog; read_task reads it`,
      ].join("\n"),
    );
  });

  it("read_task names the Idea it was shaped from, and read_idea the Task it was shaped into", async () => {
    const idea = await work.app
      .get(IdeaService)
      .capture({ title: "Voice notes", notes: "", projectId }, THE_USER);
    const task = await work.app.get(IdeaService).shape(idea.id, projectId, THE_USER);

    const taskRecord = await call(READ_TASK, { taskId: task.id });
    const ideaRecord = await call(READ_IDEA, { ideaId: idea.id });

    expect(taskRecord.text).toContain(
      `- Shaped from: Voice notes (Idea ${idea.id}), shaped; read_idea reads it`,
    );
    expect(ideaRecord.text).toContain(
      `- Shaped into: Voice notes (Task ${task.id}), Backlog; read_task reads it`,
    );
  });

  it("read_task names its Initiative, read_idea the Initiative it was shaped into, and read_initiative its Idea, a dropped one marked", async () => {
    const idea = await work.app
      .get(IdeaService)
      .capture({ title: "Usage exports", notes: "", projectId }, THE_USER);
    const initiatives = work.app.get(InitiativeService);
    const initiative = await initiatives.shape(idea.id, THE_USER);
    const task = await initiatives.addTask(
      initiative.id,
      { title: "Export as CSV", projectId, priority: "normal" },
      [],
      THE_USER,
    );
    await initiatives.drop(initiative.id);

    const taskRecord = await call(READ_TASK, { taskId: task.id });
    const ideaRecord = await call(READ_IDEA, { ideaId: idea.id });
    const initiativeRecord = await call(READ_INITIATIVE, { initiativeId: initiative.id });

    const initiativeLine = `${initiative.name} (Initiative ${initiative.id}), dropped; read_initiative reads it`;
    expect(taskRecord.text).toContain(`- Part of: ${initiativeLine}`);
    expect(ideaRecord.text).toContain(`- Shaped into: ${initiativeLine}`);
    expect(initiativeRecord.text).toContain(
      `- Shaped from: Usage exports (Idea ${idea.id}), shaped; read_idea reads it`,
    );
  });
});
