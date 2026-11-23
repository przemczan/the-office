import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { PLANNING_OFFICE_TOOLS } from "../conversations/task-thread-records.js";
import type { Task } from "../../domain/task.js";
import { TaskStateChanged } from "../../domain/task-events.js";
import {
  KnownProjectsForTests,
  SessionTasksForTests,
  TaskDecisionsForTests,
  WorkSettingsForTests,
} from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import {
  MARK_PLANNED,
  PROPOSE_PIPELINE,
  WRITE_BUG_DETAILS,
  WRITE_DEFINITION_OF_DONE,
  WRITE_KIND,
  WRITE_PLAN,
  WRITE_TAGS,
} from "./planning-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { projectPipelinesForTests } from "../../../pipelines/index.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";

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
      ANN_LEE,
    );
  return work.app.get(PlanningService).plan(created.id, ANN_LEE);
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
      WRITE_KIND,
      WRITE_BUG_DETAILS,
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
    await work.app.get(TaskService).drop(task.id, ANN_LEE);
    const dropped = await call(WRITE_PLAN, { plan: "Anything." });

    expect(chat).toEqual({
      text: "This tool works in a Thread on a Task or in an Initiative's planning Thread, and this session is in neither.",
      isError: true,
    });
    expect(dropped).toEqual({
      text: "The Plan is proposed while the Task is in Planning or Ready, before it starts; this one is in Dropped.",
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
  it("proposes a Pipeline for a Task with none yet, which it follows once the user confirms it", async () => {
    const result = await call(PROPOSE_PIPELINE, { pipelineId: "full", why: "It changes code." });

    expect(result).toEqual({
      text: "Proposed the Pipeline full. The Task follows it once the user confirms it.",
      isError: false,
    });
    expect(await current()).toMatchObject({
      pipelineId: undefined,
      proposedPipeline: { pipelineId: "full", reason: "It changes code." },
    });
  });

  it("refuses a Pipeline the library doesn't have, naming those it has", async () => {
    // The library also holds Pipelines other test files add to the shared database.
    await expect(call(PROPOSE_PIPELINE, { pipelineId: "nightly", why: "No." })).resolves.toEqual({
      text: expect.stringMatching(
        /^There is no Pipeline "nightly"\. The project-[\w-]+ can choose full, quick-fix, document, onboard, proof-of-concept/,
      ),
      isError: true,
    });
  });
});

describe("propose_pipeline with Project Pipelines", () => {
  it("proposes one of the Task's Project's own Project Pipelines", async () => {
    const library = projectPipelinesForTests(work.app);
    const own = await library.aProjectPipeline(
      task.projectId,
      await library.anOfficeWidePipeline(),
    );

    const result = await call(PROPOSE_PIPELINE, { pipelineId: own.id, why: "It needs Linux." });

    expect(result.isError).toBe(false);
    expect((await current()).proposedPipeline).toEqual({
      pipelineId: own.id,
      reason: "It needs Linux.",
    });
  });

  it("refuses another Project's Project Pipeline and one Broken before The Office updated, naming it and why", async () => {
    const library = projectPipelinesForTests(work.app);
    const base = await library.anOfficeWidePipeline();
    const others = await library.aProjectPipeline("project-other", base);
    const own = await library.aProjectPipeline(task.projectId, base);
    await library.breakProjectPipeline(own);

    const another = await call(PROPOSE_PIPELINE, { pipelineId: others.id, why: "No." });
    const broken = await call(PROPOSE_PIPELINE, { pipelineId: own.id, why: "No." });

    expect(another).toEqual({
      text: `${others.name} is a Project Pipeline of The project-other: only The project-other's Tasks can follow it.`,
      isError: true,
    });
    expect(broken).toEqual({
      text: `${own.name} was Broken before The Office updated: Inserts Verify on Linux after Tests, which its base Pipeline no longer has. Save it once in The ${task.projectId}'s Pipelines, or choose another Pipeline.`,
      isError: true,
    });
    expect((await current()).proposedPipeline).toBeUndefined();
  });

  it("is refused when auto mode would accept a Project Pipeline flagged Broken before The Office updated since it was proposed", async () => {
    await inAutoMode();
    await writeTheParts();
    const library = projectPipelinesForTests(work.app);
    const base = await library.anOfficeWidePipeline();
    const own = await library.aProjectPipeline(task.projectId, base);
    await call(PROPOSE_PIPELINE, { pipelineId: own.id, why: "It needs Linux." });
    await library.breakProjectPipeline(own);

    expect(await call(MARK_PLANNED, {})).toEqual({
      text: expect.stringMatching(
        new RegExp(`^${own.name} was Broken before The Office updated: `),
      ) as string,
      isError: true,
    });
    expect((await current()).state).toBe("planning");
  });
});

/** Why a Task of the Project can't follow Full, which runs test, when the Project lacks it. */
function refusal(projectId: string): string {
  return `The Pipeline Full runs test, which The ${projectId} has no command for. Add it on the Project page, or choose another Pipeline.`;
}

describe("a Pipeline running a command the Task's Project lacks", () => {
  const withoutTest = [{ key: "build", name: "Build", commandLine: "npm run build" }];

  it("is refused when the Planner proposes it or the user confirms it, naming the command and the Project", async () => {
    work.app.get(KnownProjectsForTests).commands.set(task.projectId, withoutTest);

    const proposed = await call(PROPOSE_PIPELINE, { pipelineId: "full", why: "It changes code." });
    const confirming = work.app.get(PlanningService).confirmPipeline(task.id, "full");

    expect(proposed).toEqual({ text: refusal(task.projectId), isError: true });
    await expect(confirming).rejects.toThrow(refusal(task.projectId));
    expect(await current()).toMatchObject({ pipelineId: undefined, proposedPipeline: undefined });
  });

  it("is refused when auto mode would accept it, as the command was removed since it was proposed", async () => {
    await inAutoMode();
    await writeTheParts();
    await call(PROPOSE_PIPELINE, { pipelineId: "full", why: "It changes code." });
    work.app.get(KnownProjectsForTests).commands.set(task.projectId, withoutTest);

    expect(await call(MARK_PLANNED, {})).toEqual({ text: refusal(task.projectId), isError: true });
    expect((await current()).state).toBe("planning");
  });
});

describe("write_tags", () => {
  it("sets the session's Task's Tags at once, normalized, and names the other Tags in use", async () => {
    const other = await work.app
      .get(TaskService)
      .create(
        { title: "Export logs", projectId: "firmware", priority: "low", tags: ["docs"] },
        ANN_LEE,
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

describe("write_kind", () => {
  it("changes the session's Task's Kind at once, leaving it in Planning", async () => {
    const result = await call(WRITE_KIND, { kind: "bug" });

    expect(result).toEqual({ text: "The Task is a Bug now.", isError: false });
    expect(await current()).toMatchObject({ kind: "bug", state: "planning" });
  });
});

describe("write_bug_details", () => {
  it("sets the fields given, keeps those left out, and clears one given null", async () => {
    const cause = await work.app
      .get(TaskService)
      .create({ title: "Passkeys", projectId: task.projectId, priority: "normal" }, ANN_LEE);

    await call(WRITE_BUG_DETAILS, { causedBy: cause.id, foundInVersion: "v1.14.2" });
    const result = await call(WRITE_BUG_DETAILS, { foundInVersion: null });

    expect(result).toEqual({
      text: `The Task's bug details are now: Caused by Task ${cause.id}; Found in version none.`,
      isError: false,
    });
    expect(await current()).toMatchObject({ causedBy: cause.id, foundInVersion: undefined });
  });

  it("refuses Caused by of the Task itself, with the reason", async () => {
    const result = await call(WRITE_BUG_DETAILS, { causedBy: task.id });

    expect(result).toEqual({ text: "A Task can't be caused by itself.", isError: true });
  });
});

/** The Plan, the Definition of Done and a proposed Pipeline, as the Planner writes them. */
async function writeTheParts(): Promise<void> {
  await call(WRITE_PLAN, { plan: "Keep the requested path through the sign-in." });
  await call(WRITE_DEFINITION_OF_DONE, { statements: ["Signing in returns to the page."] });
  await call(PROPOSE_PIPELINE, { pipelineId: "quick-fix", why: "One small change." });
}

async function inAutoMode(): Promise<void> {
  const created = await work.app
    .get(TaskService)
    .create(
      { title: "Remember the sort", projectId: `project-${randomUUID()}`, priority: "normal" },
      ANN_LEE,
    );
  task = await work.app.get(PlanningService).makeAPlan(created.id, true, ANN_LEE);
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
      text: "Auto mode accepted the Task: it confirmed what wasn't confirmed yet and marked the Task Ready. Its planning is done.",
      isError: false,
    });
    expect(await current()).toMatchObject({ state: "ready", planConfirmed: true });
  });

  it("refuses before the Plan, the Definition of Done and a Pipeline are written, with the reasons", async () => {
    const result = await call(MARK_PLANNED, {});

    expect(result).toEqual({
      text: "Write the Plan first, with write_plan. Write the Definition of Done first, with write_definition_of_done. The Task has no Pipeline yet: propose a Pipeline with propose_pipeline first.",
      isError: true,
    });
  });
});

/** The session's Task planned in auto mode and marked Ready by it. */
async function readyInAutoMode(): Promise<void> {
  await inAutoMode();
  await writeTheParts();
  await call(MARK_PLANNED, {});
}

describe("on a Ready Task", () => {
  it("a changing write takes it back to Planning, moved by the Planner, and auto mode marks it Ready again", async () => {
    await readyInAutoMode();
    const publishedBefore = work.published.length;

    const written = await call(WRITE_PLAN, { plan: "Keep the path, and the query string too." });

    expect(written.isError).toBe(false);
    expect(await current()).toMatchObject({
      state: "planning",
      planConfirmed: false,
      definitionOfDoneConfirmed: true,
      markedPlanned: false,
      autoMode: true,
    });
    expect((await work.app.get(TaskService).stateChangesOf(task.id)).at(-1)).toMatchObject({
      from: "ready",
      to: "planning",
      by: { kind: "person", roleKey: "planner" },
    });

    const accepted = await call(MARK_PLANNED, {});

    expect(accepted.isError).toBe(false);
    expect(await current()).toMatchObject({ state: "ready", planConfirmed: true });
    const moves = work.published
      .slice(publishedBefore)
      .filter((event) => event instanceof TaskStateChanged)
      .filter(({ taskId }) => taskId === task.id)
      .map(({ from, to }) => [from, to]);
    expect(moves).toEqual([
      ["ready", "planning"],
      ["planning", "ready"],
    ]);
  });

  it("moves nothing for a write that changes nothing, and refuses mark_planned while Ready", async () => {
    await readyInAutoMode();

    await call(WRITE_PLAN, { plan: "Keep the requested path through the sign-in." });
    const marked = await call(MARK_PLANNED, {});

    expect(await current()).toMatchObject({ state: "ready", planConfirmed: true });
    expect(marked).toEqual({
      text: "A Task is marked planned while it is in Planning; this one is in Ready.",
      isError: true,
    });
  });

  it("takes the Definition of Done and a Pipeline back to Planning too, leaving the user to confirm with auto mode off", async () => {
    await writeTheParts();
    await call(MARK_PLANNED, {});
    const planning = work.app.get(PlanningService);
    await planning.confirmPlan(task.id);
    await planning.confirmDefinitionOfDone(task.id);
    await planning.confirmPipeline(task.id, "quick-fix");
    await planning.markReady(task.id, ANN_LEE);

    await call(WRITE_DEFINITION_OF_DONE, { statements: ["The query string is kept too."] });
    expect(await current()).toMatchObject({ state: "planning", definitionOfDoneConfirmed: false });
    const markedAgain = await call(MARK_PLANNED, {});
    await planning.confirmDefinitionOfDone(task.id);
    await planning.markReady(task.id, ANN_LEE);
    await call(PROPOSE_PIPELINE, { pipelineId: "full", why: "It changes code." });

    expect(markedAgain.text).toContain("Auto mode is off: the user confirms");
    expect(await current()).toMatchObject({ state: "planning", markedPlanned: false });
  });
});
