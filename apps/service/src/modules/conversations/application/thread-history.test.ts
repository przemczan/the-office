import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { RoleCards } from "../../people/index.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import type { MessageDraft } from "../domain/message.js";
import { aProposedCard } from "../domain/proposal.fixtures.js";
import type { Home, Thread } from "../domain/thread.js";
import { aThread } from "../domain/thread.fixtures.js";
import { logMessages } from "../domain/thread-changes.js";
import { ProjectRecordSource } from "../ports/project-record-source.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { StageThreadMessages } from "./stage-thread-messages.js";
import { ThreadHistory } from "./thread-history.js";
import { WorkRecords } from "./work-records.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import { ANN_LEE } from "../domain/user.fixtures.js";

// Every test file shares the database: this one's Roles, Tasks and Project are its own, and its
// messages are logged on a day nobody else's are.
const DEVELOPER = `developer-${randomUUID()}`;
const CARETAKER = `caretaker-${randomUUID()}`;
const TASK = randomUUID();
const OTHER_TASK = randomUUID();
const INITIATIVE = randomUUID();
const PROJECT = `project-${randomUUID()}`;
const DAY = "2032-07-14";

let app: INestApplication;
let history: ThreadHistory;
let repository: ThreadRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [
      ThreadHistory,
      StageThreadMessages,
      WorkRecords,
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      {
        provide: RoleCards,
        useValue: {
          find: (roleKey: string) =>
            Promise.resolve(
              roleKey === DEVELOPER
                ? {
                    roleKey,
                    cardVersion: 1,
                    mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
                    card: aProposedCard({ name: "Jim", title: "Developer" }),
                  }
                : undefined,
            ),
          findLetGo: (roleKey: string) =>
            Promise.resolve(roleKey === CARETAKER ? { name: "Jan" } : undefined),
          roleTitle: () => "Caretaker",
        } satisfies Pick<RoleCards, "find" | "findLetGo" | "roleTitle"> as unknown as RoleCards,
      },
      {
        provide: ProjectRecordSource,
        useValue: {
          of: (projectId: string) =>
            Promise.resolve(projectId === PROJECT ? "The project" : undefined),
        } satisfies ProjectRecordSource,
      },
    ],
  }));
  app.get(WorkRecords).provide({
    taskSubjects: () => Promise.resolve(new Map()),
    taskRecord: () => Promise.resolve(undefined),
    taskTitle: (taskId) =>
      Promise.resolve(
        ({ [TASK]: "Fix login", [OTHER_TASK]: "Export" } as Record<string, string>)[taskId],
      ),
    taskAttachmentIds: () => Promise.resolve([]),
    initiativeTaskAttachmentIds: () => Promise.resolve(undefined),
    isInitiativePlanningThread: () => Promise.resolve(true),
    initiativeAttachmentIds: () => Promise.resolve([]),
    initiativeRecord: () => Promise.resolve(undefined),
    initiativeName: (id) => Promise.resolve(id === INITIATIVE ? "Offline sync" : undefined),
    projectWork: (projectId) =>
      Promise.resolve(
        projectId === PROJECT
          ? { taskIds: [TASK], initiativeIds: [INITIATIVE] }
          : { taskIds: [], initiativeIds: [] },
      ),
    ideaRecord: () => Promise.resolve(undefined),
  });
  history = app.get(ThreadHistory);
  repository = app.get(ThreadRepository);
  await logged(DEVELOPER, { kind: "chat", roleKey: DEVELOPER }, "09:00", [
    { kind: "user", text: "Why did the build fail?", delivery: "delivered", writtenBy: ANN_LEE },
    { kind: "tool-activity", roleKey: DEVELOPER, tool: "Bash", summary: "npm run build\nmore" },
    { kind: "person", roleKey: DEVELOPER, text: "A missing import." },
  ]);
  await logged(DEVELOPER, { kind: "task", taskId: TASK }, "10:00", [
    { kind: "person", roleKey: DEVELOPER, text: "The login works again." },
  ]);
  await logged(CARETAKER, { kind: "task", taskId: OTHER_TASK }, "11:00", [
    { kind: "person", roleKey: CARETAKER, text: "Exported." },
  ]);
  await logged(CARETAKER, { kind: "initiative", initiativeId: INITIATIVE }, "12:00", [
    { kind: "person", roleKey: CARETAKER, text: "Shaped it." },
  ]);
  // An earlier planning Thread on the Initiative, beside its shaping Thread.
  await logged(CARETAKER, { kind: "initiative", initiativeId: INITIATIVE }, "13:00", [
    { kind: "person", roleKey: CARETAKER, text: "Planned the sync's first Task." },
  ]);
});

afterAll(async () => {
  await app.close();
});

/** A Thread with the person in the home, its messages logged from `time` on the day, a minute apart. */
async function logged(
  roleKey: string,
  home: Home,
  time: string,
  drafts: readonly MessageDraft[],
  day: string = DAY,
): Promise<Thread> {
  const thread = aThread({ id: randomUUID(), home, roleKey, stageThread: home.kind === "task" });
  await repository.add(thread);
  const start = new Date(`${day}T${time}:00.000Z`).getTime();
  const messages = drafts.map((draft, index) => ({
    ...draft,
    id: randomUUID(),
    threadId: thread.id,
    at: new Date(start + index * 60_000),
  }));
  await repository.update(thread.id, (current) => logMessages(current, messages, new Date()));
  return thread;
}

const onTheDay = { from: DAY, to: DAY };

describe("ThreadHistory", () => {
  it("reads a person's Threads on a day, grouped, with their subjects, speakers and times", async () => {
    const answer = await history.read({ ...onTheDay, personRole: DEVELOPER });

    expect(answer).toContain(
      "Thread messages logged from 2032-07-14 00:00 UTC to 2032-07-14 23:59 UTC, with Jim, the Developer: 4 in 2 Threads",
    );
    expect(answer).toMatch(
      /## Chat with Jim, the Developer: "Why did the build fail" \(Thread [\w-]+\)\n\n- 2032-07-14 09:00 UTC · the user Ann Lee: Why did the build fail\?\n- 2032-07-14 09:01 UTC · Jim, the Developer: \[Bash\] npm run build …\n- 2032-07-14 09:02 UTC · Jim, the Developer: A missing import\./,
    );
    expect(answer).toContain(
      `## Jim, the Developer's Stage Thread on the Task "Fix login" (Task ${TASK})`,
    );
    expect(answer).not.toContain("Exported.");
  });

  it("reads a Task's Threads, and a Project's Tasks' and Initiatives'", async () => {
    const onTask = await history.read({ ...onTheDay, taskId: OTHER_TASK });
    expect(onTask).toContain("Jan, once the Caretaker: Exported.");
    expect(onTask).not.toContain("login");

    const inProject = await history.read({ ...onTheDay, projectId: PROJECT });
    expect(inProject).toContain("The login works again.");
    expect(inProject).toContain(
      `Thread on the Initiative "Offline sync" (Initiative ${INITIATIVE})`,
    );
    expect(inProject).not.toContain("Exported.");
    expect(inProject).not.toContain("build");

    await expect(
      history.read({ ...onTheDay, projectId: PROJECT, taskId: OTHER_TASK }),
    ).resolves.toMatch(/^No Thread messages were logged/);
  });

  it("reads an Initiative's Threads, its shaping and planning Threads alone", async () => {
    const onInitiative = await history.read({ ...onTheDay, initiativeId: INITIATIVE });

    expect(onInitiative).toContain('on the Initiative "Offline sync": 2 in 2 Threads');
    expect(onInitiative).toContain("Shaped it.");
    expect(onInitiative).toContain("Planned the sync's first Task.");
    expect(onInitiative).not.toContain("Exported.");
    expect(onInitiative).not.toContain("login");
    await expect(
      history.read({ ...onTheDay, initiativeId: INITIATIVE, projectId: PROJECT }),
    ).resolves.toContain("Shaped it.");
    await expect(
      history.read({ ...onTheDay, initiativeId: INITIATIVE, taskId: TASK }),
    ).resolves.toMatch(/^No Thread messages were logged/);
    const unknown = randomUUID();
    await expect(history.read({ ...onTheDay, initiativeId: unknown })).resolves.toBe(
      `The Office has no Initiative ${unknown}: read_task names a Task's Initiative by its id.`,
    );
  });

  it("finds the messages holding a text, in any case", async () => {
    const answer = await history.read({ ...onTheDay, personRole: DEVELOPER, search: "MISSING" });

    expect(answer).toContain("1 in 1 Thread");
    expect(answer).toContain("A missing import.");
    expect(answer).not.toContain("Why did the build fail?");
  });

  it("reads a time with no offset in UTC, as it reads a date", async () => {
    const answer = await history.read({
      from: `${DAY}T09:01`,
      to: `${DAY}T10:00:00`,
      personRole: DEVELOPER,
    });

    expect(answer).toContain("from 2032-07-14 09:01 UTC to 2032-07-14 10:00 UTC");
    expect(answer).toContain("3 in 2 Threads");
    expect(answer).not.toContain("Why did the build fail?");
  });

  it.each([
    [{ personRole: "nobody" }, "Nobody fills or filled the Role nobody"],
    [{ taskId: "no-such-task" }, "The Office has no Task no-such-task"],
    [{ projectId: "no-such-project" }, "The Office has no Project no-such-project"],
    [{ from: "2032-07-15", to: DAY }, "The range ends before it starts"],
    [{ from: "last week" }, 'The from "last week" is no date or time'],
    [
      { from: "2032-07-13", to: "2032-07-13", personRole: DEVELOPER },
      "No Thread messages were logged",
    ],
  ])("answers %o with a plain sentence", async (asked, sentence) => {
    await expect(history.read({ ...onTheDay, ...asked })).resolves.toMatch(
      new RegExp(`^${sentence}`),
    );
  });
});

describe("StageThreadMessages", () => {
  // A day of its own, so the Threads above count none of these messages.
  const STAGE_DAY = "2032-07-16";
  const at = (time: string) => new Date(`${STAGE_DAY}T${time}:00.000Z`);
  let stageThread: Thread;

  beforeAll(async () => {
    stageThread = await logged(
      DEVELOPER,
      { kind: "task", taskId: TASK },
      "13:00",
      [
        { kind: "person", roleKey: DEVELOPER, text: "Before the run." },
        { kind: "person", roleKey: DEVELOPER, text: "Tried the old route first." },
        { kind: "tool-activity", roleKey: DEVELOPER, tool: "Bash", summary: "npm test\nFAIL" },
        { kind: "person", roleKey: DEVELOPER, text: `It failed: ${"x".repeat(5_000)}` },
        { kind: "person", roleKey: DEVELOPER, text: "After the run." },
      ],
      STAGE_DAY,
    );
    await logged(
      CARETAKER,
      { kind: "task", taskId: TASK },
      "13:02",
      [{ kind: "person", roleKey: CARETAKER, text: "Another Thread on the Task." }],
      STAGE_DAY,
    );
  });

  const runWindow = () => ({
    taskId: TASK,
    threadId: stageThread.id,
    from: at("13:01"),
    to: at("13:03"),
  });

  it("reads the Stage Thread's messages in the run's window alone, worded as read_threads words them", async () => {
    const words = await app.get(StageThreadMessages).words(runWindow(), 60_000);

    expect(words).toContain(
      `## Jim, the Developer's Stage Thread on the Task "Fix login" (Task ${TASK})`,
    );
    expect(words).toContain(
      "- 2032-07-16 13:01 UTC · Jim, the Developer: Tried the old route first.",
    );
    expect(words).toContain("- 2032-07-16 13:02 UTC · Jim, the Developer: [Bash] npm test …");
    expect(words).toMatch(/It failed: x+\n {2}… \d+ characters cut …/);
    expect(words).not.toContain("Before the run.");
    expect(words).not.toContain("After the run.");
    expect(words).not.toContain("Another Thread on the Task.");
    await expect(app.get(StageThreadMessages).count(runWindow())).resolves.toBe(3);
  });

  it("keeps within the limit it is given, saying how many messages are left out and how read_threads reads on", async () => {
    const words = await app.get(StageThreadMessages).words(runWindow(), 2_000);

    expect(words.length).toBeLessThanOrEqual(2_000);
    expect(words).toContain("Tried the old route first.");
    expect(words).not.toContain("It failed");
    const lastShown = (await repository.messages(stageThread.id))[2];
    expect(words).toContain(
      `… 1 more message is left out to keep this answer within 2000 characters: read_threads with taskId "${TASK}", from "2032-07-16T13:01:00.000Z", to "2032-07-16T13:03:00.000Z" and after "${lastShown?.id}" reads on, where your session has it.`,
    );
  });
});
