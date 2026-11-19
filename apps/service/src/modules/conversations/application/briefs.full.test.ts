import { randomUUID } from "node:crypto";
import { ContractMessageImageRules } from "../adapters/http/contract-message-image-rules.js";
import { MessageImageRules } from "../ports/message-image-rules.js";
import { MessageImages } from "./message-images.js";
import { ThreadImages } from "./thread-images.js";
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
import { oneOptionAnswer, oneWordsAnswer, type Decision } from "../domain/decision.js";
import { aDecision } from "../domain/decision.fixtures.js";
import type { Thread } from "../domain/thread.js";
import { logMessages } from "../domain/thread-changes.js";
import { aThread, aUserMessage } from "../domain/thread.fixtures.js";
import { ProjectBases, type InitiativeBranchReads } from "../ports/project-bases.js";
import { projectBasesOver } from "../ports/project-bases.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import {
  InitiativeThreadSetups,
  type InitiativeThreadRequest,
} from "./initiative-thread-setups.js";
import { sessionMemoryProvider, type MemoryAsk } from "./session-memory.fixtures.js";
import { TaskThreadSetups, type TaskThreadRequest } from "./task-thread-setups.js";
import { ConversationsPromptTemplatesForTests } from "../adapters/prompt-templates/conversations-prompt-templates.fixtures.js";
import { defaultPromptTexts, PromptTemplates } from "../../prompt-templates/index.js";
import { CONVERSATIONS_PROMPT_TEMPLATES } from "../domain/conversations-prompt-templates.js";
import {
  PromptTemplateRepository,
  PromptTemplateRepositoryForTests,
} from "../../prompt-templates/index.fixtures.js";
import { TASK_THREAD_BRIEF } from "../domain/brief-templates.js";
import { ANN_LEE } from "../domain/user.fixtures.js";

const PROMPTS = defaultPromptTexts(CONVERSATIONS_PROMPT_TEMPLATES);

const ADMIN_PANEL: BriefProject = {
  projectId: "admin-panel",
  name: "Admin panel",
  baseBranch: "main",
  folder: "/office/bases/admin-panel",
};

const PROJECTS: BriefProject[] = [ADMIN_PANEL];

/** As a session on an Initiative with a Pipeline reads them: at the Initiative's branch. */
const ON_THE_BRANCH: BriefProject[] = [
  {
    ...ADMIN_PANEL,
    folder: "/office/initiative-bases/sync/admin-panel",
    initiativeBranch: { branch: "initiative/sync", gone: false },
  },
];

/** The Initiatives whose Threads read their branch, by id, with what they read there. */
const branchReads = new Map<string, InitiativeBranchReads>();
const listedOnInitiative: InitiativeBranchReads[] = [];

let app: INestApplication;
let briefs: Briefs;
let repository: ThreadRepository;

const MEMORY: BriefMemory = { lines: ["- 2026-10-10: Prefers short answers."], leftOut: 1 };
const asked: MemoryAsk[] = [];

beforeAll(async () => {
  const bases: ProjectBases = {
    ...projectBasesOver("/office/bases", PROJECTS),
    listOnInitiative: (reads) => {
      listedOnInitiative.push(reads);
      return Promise.resolve(ON_THE_BRANCH);
    },
  };
  ({ app } = await startTestApplication({
    imports: [ConversationsPromptTemplatesForTests],
    database: true,
    // The test saves a real template's text, which every other test file would read.
    overrides: [
      { provide: PromptTemplateRepository, useValue: new PromptTemplateRepositoryForTests() },
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: ProjectBases, useValue: bases },
      TaskThreadSetups,
      InitiativeThreadSetups,
      sessionMemoryProvider(MEMORY, asked),
      Briefs,
      MessageImages,
      ThreadImages,
      { provide: MessageImageRules, useClass: ContractMessageImageRules },
    ],
  }));
  app.get(InitiativeThreadSetups).provide({
    setUp: ({ initiativeId }: InitiativeThreadRequest) =>
      Promise.resolve({
        instructions: "You shape the Initiative.",
        officeTools: [],
        record: recordOf(initiativeId),
        asking: false,
        sessionRefusal: undefined,
        branchReads: branchReads.get(initiativeId),
      }),
  });
  app.get(TaskThreadSetups).provide({
    planner: () => Promise.resolve("planner"),
    readyForPersonsThread: () => Promise.resolve(undefined),
    planningThreadElsewhere: () => Promise.resolve(undefined),
    setUp: ({ taskId }: TaskThreadRequest) =>
      Promise.resolve({
        projectId: "admin-panel",
        initiativeId: undefined,
        projectName: "Admin panel",
        pipelineName: "",
        folder: `/office/worktrees/admin-panel/${taskId}`,
        environment: {},
        useProjectSkills: true,
        projectSkillsOff: [],
        instructions: "You plan the Task.",
        officeTools: [],
        brief: recordOf(taskId),
        asking: false,
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
  officeInstructionsVersion: 0,
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
      newChatThreadBrief(PROMPTS, PROJECTS, MEMORY),
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
      freshChatThreadBrief(PROMPTS, {
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
      taskThreadBrief(PROMPTS, { ...record, continuing: false }),
    );
    await expect(briefs.forThread(aThread({ home, session: A_SESSION }))).resolves.toEqual(
      taskThreadBrief(PROMPTS, { ...record, continuing: true }),
    );
  });

  it("briefs a Thread on a Task in the Task Thread's Brief's saved text", async () => {
    const taskId = randomUUID();
    const templates = app.get(PromptTemplates);
    await templates.save(
      TASK_THREAD_BRIEF.key,
      "{{record}}\n\nAsk before you start.{{#memory}}\n\n{{memory}}{{/memory}}",
      ANN_LEE,
    );

    try {
      const brief = await briefs.forThread(aThread({ home: { kind: "task", taskId } }));

      expect(brief.text).toBe(
        `${recordOf(taskId)}\n\nAsk before you start.\n\n## Your Memory\n\nNotes you wrote in earlier sessions, oldest first:\n\n- 2026-10-10: Prefers short answers.\n\n1 older note left out.`,
      );
    } finally {
      await templates.resetToDefault(TASK_THREAD_BRIEF.key, ANN_LEE);
    }
  });

  it("briefs a Thread on an Initiative from its record, the Memory for no Project and every Project", async () => {
    asked.length = 0;
    const initiativeId = randomUUID();
    const home = { kind: "initiative", initiativeId } as const;
    const record = { record: recordOf(initiativeId), memory: MEMORY, projects: PROJECTS };

    await expect(briefs.forThread(aThread({ roleKey: "cto", home }))).resolves.toEqual(
      initiativeThreadBrief(PROMPTS, { ...record, continuing: false }),
    );
    await expect(
      briefs.forThread(aThread({ roleKey: "cto", home, session: A_SESSION })),
    ).resolves.toEqual(initiativeThreadBrief(PROMPTS, { ...record, continuing: true }));
    expect(asked).toEqual([
      { roleKey: "cto", reach: { kind: "all-projects" } },
      { roleKey: "cto", reach: { kind: "all-projects" } },
    ]);
  });

  it("briefs a Thread on an Initiative with a Pipeline from where its branch is read", async () => {
    const initiativeId = randomUUID();
    const reads = { shortName: "sync", branch: "initiative/sync", projectIds: ["admin-panel"] };
    branchReads.set(initiativeId, reads);
    const home = { kind: "initiative", initiativeId } as const;

    await expect(briefs.forThread(aThread({ roleKey: "cto", home }))).resolves.toEqual(
      initiativeThreadBrief(PROMPTS, {
        record: recordOf(initiativeId),
        memory: MEMORY,
        projects: ON_THE_BRANCH,
        continuing: false,
      }),
    );
    expect(listedOnInitiative).toEqual([reads]);
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
      answer: { ...oneOptionAnswer(1), answeredAt },
    });
    const second = aDecision({
      threadId: planning.id,
      taskId,
      questions: [{ kind: "open", question: "Which format?" }],
      answer: { ...oneWordsAnswer("CSV."), answeredAt: new Date(answeredAt.getTime() + 1) },
    });
    const open = aDecision({
      threadId: planning.id,
      taskId,
      questions: [{ kind: "open", question: "Which columns?" }],
    });
    const elsewhere = aDecision({
      threadId: (
        await added(aThread({ id: randomUUID(), home: { kind: "task", taskId: randomUUID() } }))
      ).id,
      answer: { ...oneOptionAnswer(0), answeredAt },
    });
    await added(planning);
    await added(another);
    for (const decision of [first, second, open, elsewhere]) await saved(decision);

    const thread = await repository.find(planning.id);

    expect(thread?.openDecisions[0]).toEqual(open);
    await expect(briefs.forThread(thread ?? planning)).resolves.toEqual(
      taskThreadBrief(PROMPTS, {
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
