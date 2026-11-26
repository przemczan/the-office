import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { TaskService } from "../../application/task-service.js";
import type { Task } from "../../domain/task.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import {
  SessionInitiativesForTests,
  SessionTasksForTests,
} from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { INITIATIVE_PLANNING_OFFICE_TOOLS } from "../conversations/initiative-thread-records.js";
import { PLANNING_OFFICE_TOOLS } from "../conversations/task-thread-records.js";
import { WRITE_COMMIT_MESSAGE } from "./commit-message-office-tools.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

let officeData: string;
let work: WorkApplication;
let task: Task;

const SESSION = "stage-session";
const CHAT_SESSION = "chat-session";
const INITIATIVE_SESSION = "initiative-planning-session";

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-commit-message-tools-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  task = await work.app
    .get(TaskService)
    .create(
      { title: "Fix the login redirect", projectId: `project-${randomUUID()}`, priority: "normal" },
      ANN_LEE,
    );
  work.app.get(SessionTasksForTests).tasks.set(SESSION, task.id);
  work.app.get(SessionInitiativesForTests).initiatives.set(INITIATIVE_SESSION, randomUUID());
});

afterEach(async () => {
  await work.app.close();
});

function call(input: Record<string, unknown>, sessionId = SESSION) {
  const [tool] = work.app.get(OfficeToolRegistry).named([WRITE_COMMIT_MESSAGE], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${WRITE_COMMIT_MESSAGE}.`);
  return tool.run(input, anOfficeToolCall(sessionId));
}

function current(): Promise<Task> {
  return work.app.get(TaskService).read(task.id);
}

it("is among the planning sessions' Office tools", () => {
  expect(PLANNING_OFFICE_TOOLS).toContain(WRITE_COMMIT_MESSAGE);
  expect(INITIATIVE_PLANNING_OFFICE_TOOLS).toContain(WRITE_COMMIT_MESSAGE);
});

describe("write_commit_message", () => {
  it("writes the commit message onto the session's Task, never moving it", async () => {
    const answer = await call({ message: "fix(login): land where I came from\n\nKeeps filters." });

    expect(answer).toEqual({ text: "Wrote the commit message onto the Task.", isError: false });
    expect(await current()).toMatchObject({
      state: "backlog",
      commitMessage: "fix(login): land where I came from\n\nKeeps filters.",
    });
  });

  it("refuses another Task's id in a Thread on a Task, and a session on none", async () => {
    const other = await call({ taskId: randomUUID(), message: "Anything" });
    const chat = await call({ message: "Anything" }, CHAT_SESSION);

    expect(other).toEqual({
      text: "This Thread is on one Task, and writes onto it alone: leave the Task id out.",
      isError: true,
    });
    expect(chat).toEqual({
      text: "This tool works in a Thread on a Task or in an Initiative's planning Thread, and this session is in neither.",
      isError: true,
    });
  });

  it("refuses, in an Initiative's planning Thread, a Task that isn't the Initiative's", async () => {
    const answer = await call({ taskId: task.id, message: "Anything" }, INITIATIVE_SESSION);

    expect(answer).toEqual({
      text: "The Task isn't one of this Initiative's, so this Thread can't write onto it.",
      isError: true,
    });
    expect((await current()).commitMessage).toBe("");
  });

  it("refuses once Publish landed it", async () => {
    await work.app.get(TaskService).markCommitMessagePublished(task.id);

    await expect(call({ message: "Anything" })).resolves.toEqual({
      text: "Publish has landed the commit message, so it no longer changes.",
      isError: true,
    });
  });
});
