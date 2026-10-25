import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import {
  freshChatThreadBrief,
  newChatThreadBrief,
  taskThreadBrief,
  type BriefProject,
} from "../domain/brief.js";
import { logMessages } from "../domain/thread-changes.js";
import { aThread, aUserMessage } from "../domain/thread.fixtures.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { TaskThreadSetups, type TaskThreadRequest } from "./task-thread-setups.js";

const PROJECTS: BriefProject[] = [
  { name: "Admin panel", baseBranch: "main", folder: "/office/bases/admin-panel" },
];

let app: INestApplication;
let briefs: Briefs;
let repository: ThreadRepository;

beforeAll(async () => {
  const bases: ProjectBases = {
    folder: "/office/bases",
    list: () => Promise.resolve(PROJECTS),
    refresh: () => Promise.resolve(PROJECTS),
  };
  ({ app } = await startTestApplication({
    database: true,
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: ProjectBases, useValue: bases },
      TaskThreadSetups,
      Briefs,
    ],
  }));
  app.get(TaskThreadSetups).provide({
    setUp: ({ taskId }: TaskThreadRequest) =>
      Promise.resolve({
        folder: `/office/worktrees/admin-panel/${taskId}`,
        environment: {},
        useProjectSkills: true,
        instructions: "You plan the Task.",
        officeTools: [],
        brief: recordOf(taskId),
      }),
  });
  briefs = app.get(Briefs);
  repository = app.get(ThreadRepository);
});

afterAll(async () => {
  await app.close();
});

const A_SESSION = {
  id: randomUUID(),
  roleKey: "planner",
  cardVersion: 1,
  startedAt: new Date("2026-10-25T09:00:00.000Z"),
  lastCallAt: new Date("2026-10-25T09:05:00.000Z"),
  contextTokens: 48_000,
  startContextTokens: 33_000,
  full: false,
};

describe("Briefs", () => {
  it("briefs a Thread nobody answered in yet as a new one", async () => {
    await expect(briefs.forThread(aThread({ id: randomUUID() }))).resolves.toEqual(
      newChatThreadBrief(PROJECTS),
    );
  });

  it("briefs a Thread with a session from its title and log", async () => {
    const thread = aThread({
      id: randomUUID(),
      session: A_SESSION,
    });
    await repository.add(thread);
    const said = aUserMessage(thread, "Read the deploy workflow.");
    const { thread: titled } = await repository.update(thread.id, (current) =>
      logMessages(current, [said], new Date()),
    );

    await expect(briefs.forThread(titled)).resolves.toEqual(
      freshChatThreadBrief({ title: "Read the deploy workflow", log: [said], projects: PROJECTS }),
    );
  });

  it("briefs a Thread on a Task from the Task's record, with none of its exchanges", async () => {
    const taskId = randomUUID();
    const home = { kind: "task", taskId } as const;

    await expect(briefs.forThread(aThread({ home }))).resolves.toEqual(
      taskThreadBrief(recordOf(taskId), false),
    );
    await expect(briefs.forThread(aThread({ home, session: A_SESSION }))).resolves.toEqual(
      taskThreadBrief(recordOf(taskId), true),
    );
  });
});

/** The record the Task's module gives for a Task in these tests. */
function recordOf(taskId: string): string {
  return `## The Task\n\nTask ${taskId}`;
}
