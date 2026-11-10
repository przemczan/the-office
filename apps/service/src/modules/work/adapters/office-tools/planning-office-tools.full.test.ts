import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import { PLANNING_OFFICE_TOOLS } from "../conversations/task-thread-records.js";
import type { Task } from "../../domain/task.js";
import {
  SessionTasksForTests,
  TaskDecisionsForTests,
  WorkSettingsForTests,
} from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import {
  MARK_PLANNED,
  PROPOSE_PIPELINE,
  WRITE_DEFINITION_OF_DONE,
  WRITE_PLAN,
  WRITE_TAGS,
} from "./planning-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

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
  // Its own settings: Make a plan saves the auto mode default every file would read.
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
  ]);
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
  return tool.run(input, anOfficeToolCall(sessionId));
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
      WRITE_TAGS,
      MARK_PLANNED,
    ]),
  );
});

describe("write_plan", () => {
  it("writes the Plan onto the session's Task as proposed", async () => {
    const result = await call(WRITE_PLAN, { plan: "Keep the requested path through the sign-in." });

    expect(result).toEqual({
      text: "Wrote the Plan onto the Task. It shows on the Task as not confirmed until the user confirms it; end your turn when you want them to look at it.",
      isError: false,
    });
    expect(await current()).toMatchObject({
      plan: "Keep the requested path through the sign-in.",
      planConfirmed: false,
    });
  });

  it("writes the Planner's token estimate with the Plan, and keeps it when a rewrite leaves it out", async () => {
    await call(WRITE_PLAN, { plan: "Keep the requested path.", estimatedTokens: 80_000 });
    await call(WRITE_PLAN, { plan: "Keep the requested path through the sign-in." });

    expect(await current()).toMatchObject({
      plan: "Keep the requested path through the sign-in.",
      estimatedTokens: 80_000,
    });
  });

  it("writes the files the Plan expects to change with it, shown in the Task's record", async () => {
    await call(WRITE_PLAN, {
      plan: "Keep the requested path through the sign-in.",
      filesToChange: ["src/auth/", "src/login.ts"],
    });

    expect((await current()).filesToChange).toEqual(["src/auth", "src/login.ts"]);
    expect(await work.app.get(TaskRecords).recordText(task.id)).toContain(
      "Files to change:\n- src/auth\n- src/login.ts",
    );
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
    // The library also holds Pipelines other test files add to the shared database.
    await expect(call(PROPOSE_PIPELINE, { pipelineId: "nightly", why: "No." })).resolves.toEqual({
      text: expect.stringMatching(
        /^There is no Pipeline "nightly"\. The library has full, quick-fix, document, onboard, proof-of-concept/,
      ),
      isError: true,
    });
  });
});

describe("write_tags", () => {
  it("sets the session's Task's Tags at once, normalized, and names the other Tags in use", async () => {
    const other = await work.app
      .get(TaskService)
      .create(
        { title: "Export logs", projectId: "firmware", priority: "low", tags: ["docs"] },
        THE_USER,
      );

    const result = await call(WRITE_TAGS, { tags: ["Login ", "auth flow", "login"] });

    expect(result).toMatchObject({
      text: expect.stringMatching(
        /^The Task's Tags are now login, auth-flow\. Other Tags in use: .*\bdocs\b/,
      ),
      isError: false,
    });
    expect((await current()).tags).toEqual(["login", "auth-flow"]);
    expect(other.tags).toEqual(["docs"]);
  });

  it("refuses a Tag too long, with the reason", async () => {
    const result = await call(WRITE_TAGS, { tags: ["x".repeat(33)] });

    expect(result).toEqual({
      text: `The Tag "${"x".repeat(33)}" is longer than 32 characters.`,
      isError: true,
    });
  });
});

async function writeTheParts(): Promise<void> {
  await call(WRITE_PLAN, { plan: "Keep the requested path through the sign-in." });
  await call(WRITE_DEFINITION_OF_DONE, { statements: ["Signing in returns to the page."] });
}

async function inAutoMode(): Promise<void> {
  const created = await work.app
    .get(TaskService)
    .create(
      { title: "Remember the sort", projectId: `project-${randomUUID()}`, priority: "normal" },
      THE_USER,
    );
  task = await work.app.get(PlanningService).makeAPlan(created.id, true);
  work.app.get(SessionTasksForTests).tasks.set(SESSION, task.id);
}

describe("mark_planned", () => {
  it("leaves the Task for the user to confirm with auto mode off", async () => {
    await writeTheParts();

    const result = await call(MARK_PLANNED, {});

    expect(result).toEqual({
      text: "Marked the Task planned. Auto mode is off: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.",
      isError: false,
    });
    expect(await current()).toMatchObject({ state: "planning", planConfirmed: false });
  });

  it("has auto mode mark the Task Ready, and tells the Planner to wait while a Decision is open", async () => {
    await inAutoMode();
    await writeTheParts();
    const decisions = work.app.get(TaskDecisionsForTests);
    decisions.open.set(task.id, 1);

    const waiting = await call(MARK_PLANNED, {});
    decisions.open.delete(task.id);
    const accepted = await call(MARK_PLANNED, {});

    expect(waiting).toEqual({
      text: "The Task isn't marked planned: a Decision on it is still open. End your turn; the user's answer comes as your next message. Carry on from it, then call mark_planned again.",
      isError: true,
    });
    expect(accepted).toEqual({
      text: "Auto mode accepted the Task: it confirmed what wasn't confirmed yet and marked the Task Ready. Planning is done; end your turn.",
      isError: false,
    });
    expect(await current()).toMatchObject({ state: "ready", planConfirmed: true });
  });

  it("refuses before the Plan and the Definition of Done are written, with the reasons", async () => {
    const result = await call(MARK_PLANNED, {});

    expect(result).toEqual({
      text: "Write the Plan first, with write_plan. Write the Definition of Done first, with write_definition_of_done.",
      isError: true,
    });
  });
});
