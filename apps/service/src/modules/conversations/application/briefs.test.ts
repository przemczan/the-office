import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import {
  freshChatThreadBrief,
  initiativeThreadBrief,
  newChatThreadBrief,
  taskThreadBrief,
  type BriefMemory,
  type BriefProject,
} from "../domain/brief.js";
import { TurnEnded } from "../domain/conversation-events.js";
import type { Decision } from "../domain/decision.js";
import { aDecision } from "../domain/decision.fixtures.js";
import type { Thread } from "../domain/thread.js";
import { logMessages } from "../domain/thread-changes.js";
import { aThread, aUserMessage } from "../domain/thread.fixtures.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import {
  InitiativeThreadSetups,
  type InitiativeThreadRequest,
} from "./initiative-thread-setups.js";
import { sessionMemoryProvider, type MemoryAsk } from "./session-memory.fixtures.js";
import { TaskThreadSetups, type TaskThreadRequest } from "./task-thread-setups.js";

const PROJECTS: BriefProject[] = [
  {
    projectId: "admin-panel",
    name: "Admin panel",
    baseBranch: "main",
    folder: "/office/bases/admin-panel",
  },
];

let app: INestApplication;
let briefs: Briefs;
let repository: ThreadRepository;

const MEMORY: BriefMemory = { lines: ["- 2026-10-10: Prefers short answers."], leftOut: 1 };
const asked: MemoryAsk[] = [];

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
      InitiativeThreadSetups,
      sessionMemoryProvider(MEMORY, asked),
      Briefs,
    ],
  }));
  app.get(InitiativeThreadSetups).provide({
    setUp: ({ initiativeId }: InitiativeThreadRequest) =>
      Promise.resolve({
        instructions: "You shape the Initiative.",
        officeTools: [],
        record: recordOf(initiativeId),
        sessionRefusal: undefined,
      }),
  });
  app.get(TaskThreadSetups).provide({
    setUp: ({ taskId }: TaskThreadRequest) =>
      Promise.resolve({
        projectId: "admin-panel",
        folder: `/office/worktrees/admin-panel/${taskId}`,
        environment: {},
        useProjectSkills: true,
        instructions: "You plan the Task.",
        officeTools: [],
        brief: recordOf(taskId),
        sessionRefusal: undefined,
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
  engineId: "claude-code",
  startedAt: new Date("2026-10-25T09:00:00.000Z"),
  lastCallAt: new Date("2026-10-25T09:05:00.000Z"),
  contextTokens: 48_000,
  startContextTokens: 33_000,
  full: false,
  changesAllowed: false,
};

describe("Briefs", () => {
  it("briefs a Thread nobody answered in yet as a new one", async () => {
    await expect(briefs.forThread(aThread({ id: randomUUID() }))).resolves.toEqual(
      newChatThreadBrief(PROJECTS, MEMORY),
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
      freshChatThreadBrief({
        title: "Read the deploy workflow",
        log: [said],
        projects: PROJECTS,
        memory: MEMORY,
      }),
    );
  });

  it("reads every note of the person's Memory in a chat, and the Task's Project's on a Task", async () => {
    asked.length = 0;
    const roleKey = "planner";

    await briefs.forThread(aThread({ id: randomUUID(), roleKey }));
    await briefs.forThread(aThread({ roleKey, home: { kind: "task", taskId: randomUUID() } }));

    expect(asked).toEqual([
      { roleKey, reach: { kind: "every-note", projects: PROJECTS } },
      { roleKey, reach: { kind: "project", projectId: "admin-panel" } },
    ]);
  });

  it("briefs a Thread on a Task from the Task's record, with none of its exchanges", async () => {
    const taskId = randomUUID();
    const home = { kind: "task", taskId } as const;

    const record = { record: recordOf(taskId), answered: [], open: undefined, memory: MEMORY };

    await expect(briefs.forThread(aThread({ home }))).resolves.toEqual(
      taskThreadBrief({ ...record, continuing: false }),
    );
    await expect(briefs.forThread(aThread({ home, session: A_SESSION }))).resolves.toEqual(
      taskThreadBrief({ ...record, continuing: true }),
    );
  });

  it("briefs a Thread on an Initiative from its record, the Memory for no Project and every Project", async () => {
    asked.length = 0;
    const initiativeId = randomUUID();
    const home = { kind: "initiative", initiativeId } as const;
    const record = { record: recordOf(initiativeId), memory: MEMORY, projects: PROJECTS };

    await expect(briefs.forThread(aThread({ roleKey: "cto", home }))).resolves.toEqual(
      initiativeThreadBrief({ ...record, continuing: false }),
    );
    await expect(
      briefs.forThread(aThread({ roleKey: "cto", home, session: A_SESSION })),
    ).resolves.toEqual(initiativeThreadBrief({ ...record, continuing: true }));
    expect(asked).toEqual([
      { roleKey: "cto", reach: { kind: "all-projects" } },
      { roleKey: "cto", reach: { kind: "all-projects" } },
    ]);
  });

  it("briefs a Thread on a Task with the Decisions answered in any of the Task's Threads, and the one it waits on", async () => {
    const taskId = randomUUID();
    const home = { kind: "task", taskId } as const;
    const planning = aThread({ id: randomUUID(), home });
    const another = aThread({ id: randomUUID(), home });
    const answeredAt = new Date("2026-10-25T09:10:00.000Z");
    const first = aDecision({
      threadId: another.id,
      taskId,
      answer: { kind: "option", option: 1, answeredAt },
    });
    const second = aDecision({
      threadId: planning.id,
      taskId,
      question: "Which format?",
      answer: { kind: "free-answer", text: "CSV.", answeredAt: new Date(answeredAt.getTime() + 1) },
    });
    const open = aDecision({ threadId: planning.id, taskId, question: "Which columns?" });
    const elsewhere = aDecision({
      threadId: (
        await added(aThread({ id: randomUUID(), home: { kind: "task", taskId: randomUUID() } }))
      ).id,
      answer: { kind: "option", option: 0, answeredAt },
    });
    await added(planning);
    await added(another);
    for (const decision of [first, second, open, elsewhere]) await saved(decision);

    const thread = await repository.find(planning.id);

    expect(thread?.openDecision).toEqual(open);
    await expect(briefs.forThread(thread ?? planning)).resolves.toEqual(
      taskThreadBrief({
        record: recordOf(taskId),
        continuing: false,
        answered: [first, second],
        open,
        memory: MEMORY,
      }),
    );
  });
});

async function added(thread: Thread): Promise<Thread> {
  await repository.add(thread);
  return thread;
}

/** Saves the Decision with its Thread, as opening or answering it does. */
async function saved(decision: Decision): Promise<void> {
  await repository.update(decision.threadId, (thread) => ({
    thread,
    logged: [],
    decision,
    event: new TurnEnded(thread, new Date()),
  }));
}

/** The record the Task's module gives for a Task in these tests. */
function recordOf(taskId: string): string {
  return `## The Task\n\nTask ${taskId}`;
}
