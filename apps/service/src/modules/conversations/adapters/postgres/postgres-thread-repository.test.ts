import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DecisionAnswer, DecisionQuestion } from "../../domain/decision.js";
import type { Message } from "../../domain/message.js";
import type { Thread, ThreadSession } from "../../domain/thread.js";
import { logMessages, openDecision, recordDecisionAnswer } from "../../domain/thread-changes.js";
import type { LoggedMessagesRange } from "../../ports/thread-repository.js";
import { aUserMessage } from "../../domain/thread.fixtures.js";
import { BEN_ITO } from "../../domain/user.fixtures.js";
import {
  app,
  repository,
  aThreadOfItsOwn,
  AT,
  setUpEachTest,
} from "./postgres-thread-repository.fixtures.js";
import { PostgresThreadRepository } from "./postgres-thread-repository.js";
import { decisions, proposals, threadMessages } from "./threads.schema.js";

setUpEachTest();

/** Two Threads a minute, from `AT`. */
function twoAMinute(index: number): Date {
  return new Date(AT.getTime() + Math.floor(index / 2) * 60_000);
}

/** Where the next read goes on from: after the last Thread read. */
function endOf(threads: readonly Thread[]): { readonly at: Date; readonly id: string } | undefined {
  const last = threads.at(-1);
  return last && { at: last.startedAt, id: last.id };
}

/** A session of the person's whose last engine call ended `lastCallAt`, if it made one. */
function sessionEndingAt(roleKey: string, lastCallAt: Date | undefined): ThreadSession {
  return {
    id: randomUUID(),
    roleKey,
    cardVersion: 1,
    officeInstructionsVersion: 0,
    engineId: "claude-code",
    startedAt: AT,
    lastCallAt,
    contextTokens: 0,
    startContextTokens: undefined,
    full: false,
    changesAllowed: false,
  };
}

/** A time on a day only this file's range test logs messages on. */
const at = (time: string) => new Date(`2031-03-04T${time}:00.000Z`);

describe("PostgresThreadRepository", () => {
  it("reads a person's chat newest first from where a page ends, each Thread once, with the total", async () => {
    const roleKey = `role-${randomUUID()}`;
    const chat = Array.from({ length: 7 }, (_, minute) =>
      aThreadOfItsOwn(roleKey, { startedAt: twoAMinute(minute) }),
    );
    for (const thread of chat) await repository.add(thread);
    await repository.add(aThreadOfItsOwn(`role-${randomUUID()}`));

    const first = await repository.personsThreads(roleKey, "chat", undefined, 3);
    const second = await repository.personsThreads(roleKey, "chat", endOf(first.threads), 3);
    const last = await repository.personsThreads(roleKey, "chat", endOf(second.threads), 3);

    // Two started at the same time are ordered by id, and the cursor takes them apart.
    const newestFirst = chat.toSorted(
      (one, other) =>
        other.startedAt.getTime() - one.startedAt.getTime() || (other.id > one.id ? 1 : -1),
    );
    expect([first, second, last].map(({ threads }) => threads.map(({ id }) => id))).toEqual([
      newestFirst.slice(0, 3).map(({ id }) => id),
      newestFirst.slice(3, 6).map(({ id }) => id),
      newestFirst.slice(6).map(({ id }) => id),
    ]);
    expect([first.total, second.total, last.total]).toEqual([7, 7, 7]);
  });

  it("keeps a Thread with its session and tokens, and lists a home's newest first", async () => {
    const roleKey = `role-${randomUUID()}`;
    const older = aThreadOfItsOwn(roleKey, { startedAt: new Date("2026-10-25T09:00:00.000Z") });
    const newer = aThreadOfItsOwn(roleKey, {
      startedAt: new Date("2026-10-25T09:30:00.000Z"),
      title: "Deploys",
      state: "answering",
      session: {
        id: randomUUID(),
        roleKey,
        cardVersion: 2,
        officeInstructionsVersion: 3,
        engineId: "claude-code",
        startedAt: new Date("2026-10-25T09:30:00.000Z"),
        lastCallAt: new Date("2026-10-25T09:31:00.000Z"),
        contextTokens: 41_000,
        startContextTokens: 33_000,
        full: false,
        changesAllowed: false,
      },
      override: "start-fresh",
      tokens: { input: 10, output: 200, cacheRead: 30_000, cacheCreation: 11_000 },
    });
    await repository.add(older);
    await repository.add(newer);

    await expect(repository.find(newer.id)).resolves.toEqual(newer);
    await expect(repository.listIn({ kind: "chat", roleKey })).resolves.toEqual([newer, older]);
    await expect(
      repository.listIn({ kind: "chat", roleKey: `role-${randomUUID()}` }),
    ).resolves.toEqual([]);
  });

  it("keeps a call made from a chat on no Task, with its kind, apart from Waiting on you", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);
    const call = {
      kind: "request" as const,
      context: "The user asked for it.",
      questions: [
        {
          kind: "open" as const,
          question: "Set up the Project's commands.",
          why: "Only Devops drafts them.",
        },
      ],
      putTo: "devops",
      askedAt: AT,
    };

    const { thread: waiting } = await repository.update(thread.id, (latest) =>
      openDecision(latest, { ...call, id: randomUUID() }),
    );
    const [opened] = waiting.openDecisions;

    expect(opened).toMatchObject({ kind: "request", taskId: undefined, putTo: "devops" });
    await expect(repository.decision(opened?.id ?? "")).resolves.toEqual(opened);
    await expect(repository.find(thread.id)).resolves.toMatchObject({ openDecisions: [opened] });
    expect(await repository.unansweredOnNoTask()).toContainEqual(opened);
    // One open call per chat Thread holds in the database too, past the domain's own rule.
    await expect(
      repository.update(thread.id, (latest) =>
        openDecision({ ...latest, openDecisions: [] }, { ...call, id: randomUUID() }),
      ),
    ).rejects.toThrow(/"decisions"/);
  });

  it("reads the Decisions on no Task waiting on the user in Initiatives' Threads, each with its Initiative", async () => {
    const initiativeId = randomUUID();
    const home = { kind: "initiative", initiativeId } as const;
    const asked = {
      context: "The outcome is open.",
      questions: [{ kind: "open" as const, question: "Who is it for?" }],
      askedAt: AT,
    };
    const opened = async (thread: Thread, fields: { putTo?: string; taskId?: string } = {}) => {
      const { thread: waiting } = await repository.update(thread.id, (latest) =>
        openDecision(latest, { ...asked, ...fields, id: randomUUID() }),
      );
      const decision = waiting.openDecisions.at(-1);
      if (!decision) throw new Error("It opened nothing.");
      return decision;
    };
    const shaping = aThreadOfItsOwn("shaper", { home });
    const planning = aThreadOfItsOwn("planner", { home });
    const calling = aThreadOfItsOwn("shaper", {
      home: { kind: "initiative", initiativeId: randomUUID() },
    });
    const chat = aThreadOfItsOwn(`role-${randomUUID()}`);
    for (const thread of [shaping, planning, calling, chat]) await repository.add(thread);
    const onShaping = await opened(shaping);
    const onATask = await opened(planning, { taskId: randomUUID() });
    const answeredOne = await opened(planning);
    await repository.update(planning.id, (latest) =>
      recordDecisionAnswer(latest, {
        decisionId: answeredOne.id,
        answer: { kind: "asked-again" },
        messageId: randomUUID(),
        answeredAt: AT,
        user: BEN_ITO,
      }),
    );
    const onPlanning = await opened(planning);
    const aCall = await opened(calling, { putTo: "devops" });
    const chatsCall = await opened(chat, { putTo: "devops" });

    const read = await repository.openInInitiativeThreads();

    expect(read).toContainEqual({ ...onShaping, initiativeId });
    expect(read).toContainEqual({ ...onPlanning, initiativeId });
    const ids = read.map(({ id }) => id);
    for (const left of [onATask, answeredOne, aCall, chatsCall]) expect(ids).not.toContain(left.id);
  });

  it("keeps a chat's Decision waiting on the user out of Needs you, read back after a restart", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);
    const form = {
      context: "Two ways to go.",
      questions: [
        {
          kind: "choice" as const,
          question: "Which page first?",
          options: ["Now", "Board"],
          recommendation: { option: 0, reason: "It is seen most." },
        },
        { kind: "open" as const, question: "Anything else?" },
      ],
      askedAt: AT,
    };

    const { thread: waiting } = await repository.update(thread.id, (latest) =>
      openDecision(latest, { ...form, id: randomUUID() }),
    );
    const [opened] = waiting.openDecisions;

    expect(opened).toMatchObject({ kind: "form", taskId: undefined, putTo: undefined });
    expect(await repository.openDecisions()).not.toContainEqual(opened);
    const afterRestart = new PostgresThreadRepository(app.get<Database>(DATABASE));
    await expect(afterRestart.find(thread.id)).resolves.toMatchObject({ openDecisions: [opened] });
    await expect(afterRestart.decision(opened?.id ?? "")).resolves.toEqual(opened);
    expect(await afterRestart.unansweredOnNoTask()).toContainEqual(opened);
  });

  it("reads the busy Threads: answering, or holding an open Decision", async () => {
    const roleKey = `role-${randomUUID()}`;
    const answering = aThreadOfItsOwn(roleKey, { state: "answering" });
    const holding = aThreadOfItsOwn(roleKey);
    const idle = aThreadOfItsOwn(roleKey);
    for (const thread of [answering, holding, idle]) await repository.add(thread);
    const { thread: waiting } = await repository.update(holding.id, (latest) =>
      openDecision(latest, {
        id: randomUUID(),
        context: "The run environment needs one.",
        questions: [
          {
            kind: "choice",
            question: "Which Postgres version?",
            options: ["16", "17"],
            recommendation: { option: 1, reason: "The newest is supported longest." },
          },
        ],
        putTo: "devops",
        askedAt: AT,
      }),
    );

    const busy = (await repository.busy()).filter((thread) => thread.roleKey === roleKey);

    expect(busy.toSorted((one, other) => (one.id > other.id ? 1 : -1))).toEqual(
      [answering, waiting].toSorted((one, other) => (one.id > other.id ? 1 : -1)),
    );
  });

  it("reads when each person's last engine call ended, over all their Threads", async () => {
    const called = `role-${randomUUID()}`;
    const neverCalled = `role-${randomUUID()}`;
    const latest = new Date("2026-10-25T11:45:12.345Z");
    await repository.add(aThreadOfItsOwn(called, { session: sessionEndingAt(called, AT) }));
    await repository.add(aThreadOfItsOwn(called, { session: sessionEndingAt(called, latest) }));
    await repository.add(aThreadOfItsOwn(called));
    await repository.add(
      aThreadOfItsOwn(neverCalled, { session: sessionEndingAt(neverCalled, undefined) }),
    );

    const lastCalls = await repository.lastCallsByPerson();

    expect(lastCalls.get(called)).toEqual(latest);
    expect(lastCalls.has(neverCalled)).toBe(false);
  });

  it("saves a change with the messages it logged, in their order", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);
    const messages: Message[] = [
      aUserMessage(thread, "Read the deploy workflow."),
      {
        kind: "tool-activity",
        id: randomUUID(),
        threadId: thread.id,
        roleKey: thread.roleKey,
        tool: "Read",
        summary: ".github/workflows/deploy-production.yml",
        at: AT,
      },
      {
        kind: "person",
        id: randomUUID(),
        threadId: thread.id,
        roleKey: thread.roleKey,
        text: "It deploys on every push to main.",
        at: AT,
      },
    ];

    const { thread: logged, event } = await repository.update(thread.id, (current) =>
      logMessages(current, messages, AT),
    );

    expect(logged.title).toBe("Read the deploy workflow");
    expect(event?.messages).toEqual(messages);
    await expect(repository.find(thread.id)).resolves.toEqual(logged);
    await expect(repository.messages(thread.id)).resolves.toEqual(messages);
  });

  it("reads the messages logged in a range, by the Threads' person and home, the first logged first", async () => {
    const roleKey = `role-${randomUUID()}`;
    const taskId = randomUUID();
    const chat = aThreadOfItsOwn(roleKey);
    const onTask = aThreadOfItsOwn(roleKey, { home: { kind: "task", taskId } });
    const someoneElsesOnTask = aThreadOfItsOwn(`role-${randomUUID()}`, {
      home: { kind: "task", taskId },
    });
    for (const thread of [chat, onTask, someoneElsesOnTask]) await repository.add(thread);
    const log = async (thread: Thread, text: string, time: string): Promise<Message> => {
      const message = { ...aUserMessage(thread, text), at: at(time) };
      await repository.update(thread.id, (current) => logMessages(current, [message], AT));
      return message;
    };
    const before = await log(chat, "Before the range.", "08:59");
    const first = await log(onTask, "First.", "09:00");
    const second = await log(chat, "Second.", "09:30");
    const elses = await log(someoneElsesOnTask, "Someone else's.", "09:40");
    const last = await log(onTask, "Last.", "10:00");
    await log(onTask, "After the range.", "10:01");
    const range = { from: at("09:00"), to: at("10:00") };
    const read = async (narrowed: Partial<LoggedMessagesRange>) =>
      (await repository.loggedIn({ ...range, ...narrowed })).map(({ thread, message }) => [
        thread.id,
        message.id,
      ]);

    await expect(read({ roleKey })).resolves.toEqual([
      [onTask.id, first.id],
      [chat.id, second.id],
      [onTask.id, last.id],
    ]);
    await expect(read({ homes: [{ kind: "task", taskId }] })).resolves.toEqual([
      [onTask.id, first.id],
      [someoneElsesOnTask.id, elses.id],
      [onTask.id, last.id],
    ]);
    await expect(
      read({
        roleKey,
        homes: [
          { kind: "chat", roleKey },
          { kind: "initiative", initiativeId: taskId },
        ],
      }),
    ).resolves.toEqual([[chat.id, second.id]]);
    await expect(read({ roleKey, homes: [] })).resolves.toEqual([]);
    await expect(read({ roleKey, from: at("08:00"), to: at("08:59") })).resolves.toEqual([
      [chat.id, before.id],
    ]);
  });

  it("never loses one of two changes made at once", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);

    await Promise.all(
      ["First.", "Second."].map((text) =>
        repository.update(thread.id, (current) =>
          logMessages(current, [aUserMessage(current, text)], AT),
        ),
      ),
    );

    const texts = (await repository.messages(thread.id)).map((message) =>
      message.kind === "user" ? message.text : "",
    );
    expect(texts.toSorted()).toEqual(["First.", "Second."]);
  });
});

/** A form of two questions: a choice, then an open question. */
const TWO_QUESTIONS: readonly DecisionQuestion[] = [
  {
    kind: "choice",
    question: "Which Postgres version?",
    options: ["16", "17"],
    recommendation: { option: 1, reason: "The newest is supported longest." },
  },
  { kind: "open", question: "Which extensions does it need?" },
];

function database(): Database {
  return app.get<Database>(DATABASE);
}

/** A Thread on a Task of its own, waiting on a form of `questions` its person opened. */
async function waitingOn(questions: readonly DecisionQuestion[]) {
  const thread = aThreadOfItsOwn(`role-${randomUUID()}`, {
    home: { kind: "task", taskId: randomUUID() },
  });
  await repository.add(thread);
  const { thread: waiting } = await repository.update(thread.id, (latest) =>
    openDecision(latest, {
      id: randomUUID(),
      context: "The run environment needs one.",
      questions,
      askedAt: AT,
    }),
  );
  const [opened] = waiting.openDecisions;
  if (!opened) throw new Error("No Decision opened.");
  return { thread, opened };
}

/** Ben answers the Decision the Thread waits on, as the Pipeline takes it. */
async function answer(threadId: string, decisionId: string, given: DecisionAnswer) {
  await repository.update(threadId, (latest) =>
    recordDecisionAnswer(latest, {
      decisionId,
      answer: given,
      messageId: randomUUID(),
      answeredAt: AT,
      user: BEN_ITO,
    }),
  );
}

/** The columns the release before the form reads, as kept. */
async function oneQuestionColumns(id: string) {
  const [row] = await database()
    .select({
      kind: decisions.kind,
      question: decisions.question,
      options: decisions.options,
      recommendation: decisions.recommendation,
      answer: decisions.answer,
    })
    .from(decisions)
    .where(eq(decisions.id, id));
  return row;
}

/** The answer line's body as kept. */
async function keptAnswerLine(threadId: string) {
  const rows = await database()
    .select({ body: threadMessages.body })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId));
  return rows.map(({ body }) => body).find((body) => body.kind === "decision-answer");
}

describe("PostgresThreadRepository's Decision forms", () => {
  it("keeps a form of two questions answered by Submit, with comments and a general comment", async () => {
    const { thread, opened } = await waitingOn(TWO_QUESTIONS);
    const submitted: DecisionAnswer = {
      kind: "submitted",
      answers: [
        { kind: "option", option: 0, comment: "The host runs 16." },
        { kind: "words", text: "pgvector", comment: "Only for search." },
      ],
      generalComment: "Keep it small.",
    };

    await answer(thread.id, opened.id, submitted);

    await expect(repository.decision(opened.id)).resolves.toEqual({
      ...opened,
      answer: { ...submitted, user: BEN_ITO, answeredAt: AT },
    });
    const line = (await repository.messages(thread.id)).find(
      (message) => message.kind === "decision-answer",
    );
    expect(line).toMatchObject({ decisionId: opened.id, answer: submitted });
    // The release before the form reads the first question, and the answer in words.
    await expect(oneQuestionColumns(opened.id)).resolves.toEqual({
      kind: "question",
      question: "Which Postgres version?",
      options: ["16", "17"],
      recommendation: { option: 1, reason: "The newest is supported longest." },
      answer: { kind: "free-answer", text: expect.stringContaining("pgvector"), user: BEN_ITO },
    });
    await expect(keptAnswerLine(thread.id)).resolves.toMatchObject({
      answer: { kind: "free-answer", text: expect.stringContaining("Keep it small.") },
      formAnswer: submitted,
    });
  });

  it("keeps a form answered by Ask me again, its general comment as the answer in words", async () => {
    const { thread, opened } = await waitingOn(TWO_QUESTIONS);
    const askedAgain: DecisionAnswer = {
      kind: "asked-again",
      generalComment: "Ask about the budget first.",
    };

    await answer(thread.id, opened.id, askedAgain);

    await expect(repository.decision(opened.id)).resolves.toEqual({
      ...opened,
      answer: { ...askedAgain, user: BEN_ITO, answeredAt: AT },
    });
    expect(
      (await repository.messages(thread.id)).find((message) => message.kind === "decision-answer"),
    ).toMatchObject({ answer: askedAgain });
    await expect(oneQuestionColumns(opened.id)).resolves.toMatchObject({
      answer: { kind: "free-answer", text: "Ask about the budget first.", user: BEN_ITO },
    });
  });

  it("keeps a dismissed form as Ask me again marked dismissed, which the release before reads", async () => {
    const { thread, opened } = await waitingOn(TWO_QUESTIONS);
    const dismissed: DecisionAnswer = { kind: "dismissed", generalComment: "We changed course." };

    await answer(thread.id, opened.id, dismissed);

    await expect(repository.decision(opened.id)).resolves.toEqual({
      ...opened,
      answer: { ...dismissed, user: BEN_ITO, answeredAt: AT },
    });
    expect(
      (await repository.messages(thread.id)).find((message) => message.kind === "decision-answer"),
    ).toMatchObject({ answer: dismissed });
    await expect(keptAnswerLine(thread.id)).resolves.toMatchObject({
      formAnswer: { kind: "asked-again", generalComment: "We changed course.", dismissed: true },
    });
    await expect(oneQuestionColumns(opened.id)).resolves.toMatchObject({
      answer: { kind: "free-answer", text: "We changed course.", user: BEN_ITO },
    });
  });

  it("keeps a form of one choice as one question, its option as picked, for the release before", async () => {
    const [choice] = TWO_QUESTIONS;
    if (!choice) throw new Error("No question.");
    const { thread, opened } = await waitingOn([choice]);

    await answer(thread.id, opened.id, {
      kind: "submitted",
      answers: [{ kind: "option", option: 1 }],
    });

    await expect(oneQuestionColumns(opened.id)).resolves.toEqual({
      kind: "question",
      question: "Which Postgres version?",
      options: ["16", "17"],
      recommendation: { option: 1, reason: "The newest is supported longest." },
      answer: { kind: "option", option: 1, user: BEN_ITO },
    });
    await expect(keptAnswerLine(thread.id)).resolves.toMatchObject({
      answer: { kind: "option", option: 1 },
    });
  });

  it("reads a Decision kept before the form as a form of one question, with its answer", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`, {
      home: { kind: "task", taskId: randomUUID() },
    });
    await repository.add(thread);
    const kept = {
      threadId: thread.id,
      taskId: randomUUID(),
      roleKey: "planner",
      context: "The export is wide.",
      askedAt: AT,
      answeredAt: AT,
    };
    const question = randomUUID();
    const request = randomUUID();
    const answerLine = randomUUID();
    await database()
      .insert(decisions)
      .values([
        {
          ...kept,
          id: question,
          kind: "question",
          question: "Which columns?",
          options: ["All", "Visible"],
          recommendation: { option: 1, reason: "Fewer to read." },
          answer: { kind: "option", option: 1, user: BEN_ITO },
        },
        {
          ...kept,
          id: request,
          kind: "request",
          question: "Set up the Project's commands.",
          options: [],
          recommendation: { option: 0, reason: "Only Devops drafts them." },
          answer: { kind: "free-answer", text: "Done.", answeredBy: "devops" },
        },
      ]);
    await database()
      .insert(threadMessages)
      .values({
        id: answerLine,
        threadId: thread.id,
        at: AT,
        body: {
          kind: "decision-answer",
          decisionId: question,
          answer: { kind: "option", option: 1 },
        },
      });

    await expect(repository.decision(question)).resolves.toMatchObject({
      kind: "form",
      questions: [
        {
          kind: "choice",
          question: "Which columns?",
          options: ["All", "Visible"],
          recommendation: { option: 1, reason: "Fewer to read." },
        },
      ],
      answer: {
        kind: "submitted",
        answers: [{ kind: "option", option: 1 }],
        user: BEN_ITO,
        answeredAt: AT,
      },
    });
    await expect(repository.decision(request)).resolves.toMatchObject({
      kind: "request",
      questions: [
        {
          kind: "open",
          question: "Set up the Project's commands.",
          why: "Only Devops drafts them.",
        },
      ],
      answer: {
        kind: "submitted",
        answers: [{ kind: "words", text: "Done." }],
        answeredBy: "devops",
        answeredAt: AT,
      },
    });
    await expect(repository.messages(thread.id)).resolves.toEqual([
      {
        kind: "decision-answer",
        id: answerLine,
        threadId: thread.id,
        at: AT,
        decisionId: question,
        answer: { kind: "submitted", answers: [{ kind: "option", option: 1 }] },
      },
    ]);
  });
});

describe("PostgresThreadRepository's Proposals", () => {
  it("reads a Proposal of test targets drafted before commands before the entry point, the port variable and memory, with their defaults", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);
    const entryPoint = {
      kind: "package-script",
      manifest: "package.json",
      script: "start",
      arguments: [],
    };
    const web = {
      key: "web",
      name: "Web",
      kind: "hosted",
      entryPoint,
      port: 5173,
      variables: [],
      secretVariables: [],
    };
    const android = {
      key: "android",
      name: "Android",
      kind: "build-to-install",
      entryPoint,
      outputPatterns: ["dist/*.apk"],
      variables: [],
      secretVariables: [],
    };
    const id = randomUUID();
    await database()
      .insert(proposals)
      .values({
        id,
        threadId: thread.id,
        draftedBy: "devops",
        draftedAt: AT,
        // As the release before kept it, which these fields didn't exist in.
        change: {
          kind: "test-targets",
          projectId: "admin-panel",
          changes: {
            targets: [
              { key: "web", from: web, to: { ...web, port: 3000 }, userSet: [] },
              { key: "android", from: null, to: android, userSet: [] },
            ],
          },
        } as never,
        status: "open",
        statusAt: null,
      });

    const defaults = { commandsBefore: [], memoryMegabytes: null };
    await expect(repository.proposal(id)).resolves.toMatchObject({
      change: {
        changes: {
          targets: [
            {
              from: { ...web, ...defaults, portVariable: "PORT" },
              to: { ...web, port: 3000, ...defaults, portVariable: "PORT" },
            },
            { from: null, to: { ...android, ...defaults } },
          ],
        },
      },
    });
  });
});
