import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { RoleCards } from "../../people/index.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { DecisionClosed } from "../domain/conversation-events.js";
import { oneOptionAnswer } from "../domain/decision.js";
import { DRAFT, SESSION } from "../domain/decision.fixtures.js";
import type { Thread } from "../domain/thread.js";
import { openDecision } from "../domain/thread-changes.js";
import { aThread } from "../domain/thread.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { DecisionService } from "./decision-service.js";
import { ThreadRunner } from "./thread-runner.js";
import { NO_WORK_RECORDS } from "./work-records.fixtures.js";
import { WorkRecords, type WorkRecordSource } from "./work-records.js";

let app: INestApplication;
let repository: PostgresThreadRepository;
let decisions: DecisionService;
const closed: DecisionClosed[] = [];
/** The Initiatives' planning Threads, by their ids; every other Thread on one is a shaping Thread. */
const planningThreads = new Set<string>();
/** Each Initiative's own Attachments, by its id. */
const initiativeAttachments = new Map<string, readonly string[]>();
const work: WorkRecordSource = {
  ...NO_WORK_RECORDS,
  isInitiativePlanningThread: (_initiativeId, threadId) =>
    Promise.resolve(planningThreads.has(threadId)),
  initiativeAttachmentIds: (initiativeId) =>
    Promise.resolve(initiativeAttachments.get(initiativeId) ?? []),
  initiativeTaskAttachmentIds: () => Promise.resolve([]),
};

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule],
    providers: [
      DecisionService,
      PostgresThreadRepository,
      { provide: ThreadRepository, useExisting: PostgresThreadRepository },
      // Opening and closing a Decision needs none of these: it never reaches a session.
      { provide: ThreadRunner, useValue: {} },
      { provide: RoleCards, useValue: {} },
      WorkRecords,
    ],
  }));
  app.get(WorkRecords).provide(work);
  repository = app.get(PostgresThreadRepository);
  decisions = app.get(DecisionService);
  app.get(EventBus).subscribe(DecisionClosed, (event) => {
    closed.push(event);
  });
});

afterAll(async () => {
  await app.close();
});

/**
 * A Stage Thread on the Task waiting on a Decision, on the user or put to `putTo`: its answer goes
 * to the Pipeline, not into a session, so no ThreadRunner is needed to answer it.
 */
async function waitingOn(taskId: string, putTo?: string): Promise<Thread> {
  const thread = aThread({
    id: randomUUID(),
    home: { kind: "task", taskId },
    roleKey: "developer",
    stageThread: true,
  });
  await repository.add(thread);
  const { thread: waiting } = await repository.update(thread.id, (latest) =>
    openDecision(latest, { ...DRAFT, id: randomUUID(), askedAt: new Date(), putTo }),
  );
  return waiting;
}

function decisionOf(thread: Thread): string {
  const [decision] = thread.openDecisions;
  if (!decision) throw new Error(`Thread ${thread.id} waits on no Decision.`);
  return decision.id;
}

describe("closing the Decisions of a dropped Task", () => {
  it("closes those waiting on the user and on a Consultant, and only on that Task", async () => {
    const dropped = randomUUID();
    const other = randomUUID();
    const onTheUser = await waitingOn(dropped);
    const onTheCto = await waitingOn(dropped, "cto");
    const onAnotherTask = await waitingOn(other);

    await decisions.closeOnDroppedTask(dropped);

    for (const thread of [onTheUser, onTheCto]) {
      expect(await repository.decision(decisionOf(thread))).toMatchObject({
        answer: undefined,
        closedAt: expect.any(Date),
      });
      expect((await repository.find(thread.id))?.openDecisions).toEqual([]);
    }
    expect(closed.map(({ decision }) => decision.id)).toEqual(
      expect.arrayContaining([decisionOf(onTheUser), decisionOf(onTheCto)]),
    );
    expect(await decisions.listUnansweredOn(dropped)).toEqual([]);
    expect(await decisions.openOn(dropped)).toBe(0);
    expect(await decisions.waitingOnTheUserOn(dropped)).toEqual([]);
    expect((await decisions.listOpen()).map(({ taskId }) => taskId)).not.toContain(dropped);
    expect((await decisions.listUnansweredOn(other)).map(({ id }) => id)).toEqual([
      decisionOf(onAnotherTask),
    ]);
  });

  it("refuses an answer to a closed Decision, in words saying its Task was dropped", async () => {
    const taskId = randomUUID();
    const waiting = await waitingOn(taskId);
    await decisions.closeOnDroppedTask(taskId);

    await expect(
      decisions.answer(decisionOf(waiting), oneOptionAnswer(0), { kind: "user", user: null }),
    ).rejects.toMatchObject({ reasons: ["This Decision was closed: its Task was dropped."] });
  });

  it("leaves the Thread free for a new Decision on the same Task", async () => {
    const taskId = randomUUID();
    const waiting = await waitingOn(taskId);
    await decisions.closeOnDroppedTask(taskId);

    const { thread: again } = await repository.update(waiting.id, (latest) =>
      openDecision(latest, { ...DRAFT, id: randomUUID(), askedAt: new Date() }),
    );

    expect(again.openDecisions).toHaveLength(1);
  });

  it("leaves an answered Decision as it was", async () => {
    const taskId = randomUUID();
    const waiting = await waitingOn(taskId);
    const id = decisionOf(waiting);
    await decisions.answer(id, oneOptionAnswer(1), { kind: "user", user: null });
    const answered = await repository.decision(id);

    await decisions.closeOnDroppedTask(taskId);

    expect(await repository.decision(id)).toEqual(answered);
    expect(answered?.closedAt).toBeUndefined();
  });
});

/** A Thread on the Initiative with a session of its own, its planning Thread or else its shaping Thread. */
async function onInitiative(
  initiativeId: string,
  kind: "shaping" | "planning",
): Promise<{ readonly thread: Thread; readonly sessionId: string }> {
  const sessionId = randomUUID();
  const thread = aThread({
    id: randomUUID(),
    home: { kind: "initiative", initiativeId },
    roleKey: "planner",
    session: { ...SESSION, id: sessionId },
  });
  await repository.add(thread);
  if (kind === "planning") planningThreads.add(thread.id);
  return { thread, sessionId };
}

describe("Decisions on an Initiative as a whole", () => {
  it("are refused a Task in the shaping Thread", async () => {
    const { sessionId } = await onInitiative(randomUUID(), "shaping");

    await expect(decisions.open(sessionId, DRAFT, { taskId: randomUUID() })).rejects.toMatchObject({
      reasons: ["In the shaping Thread a Decision is on no Task: leave taskId out."],
    });
  });

  it("name only the Initiative's own Attachments", async () => {
    const initiativeId = randomUUID();
    initiativeAttachments.set(initiativeId, ["of-the-initiative"]);
    const { sessionId } = await onInitiative(initiativeId, "shaping");

    await expect(
      decisions.open(sessionId, { ...DRAFT, attachmentIds: ["of-another-record"] }),
    ).rejects.toMatchObject({ reasons: [expect.stringContaining("of-another-record")] });
    const { decision } = await decisions.open(sessionId, {
      ...DRAFT,
      attachmentIds: ["of-the-initiative"],
    });
    expect(decision).toMatchObject({ taskId: undefined, attachmentIds: ["of-the-initiative"] });
  });

  it("wait on the user beside those on Tasks, never a chat's call or a Consultant's", async () => {
    const initiativeId = randomUUID();
    const shaping = await onInitiative(initiativeId, "shaping");
    const planning = await onInitiative(initiativeId, "planning");
    const calling = await onInitiative(randomUUID(), "shaping");
    const taskId = randomUUID();
    const onShaping = await decisions.open(shaping.sessionId, DRAFT);
    const onPlanning = await decisions.open(planning.sessionId, DRAFT);
    const onTask = await decisions.open(planning.sessionId, DRAFT, { taskId });
    const call = await decisions.open(calling.sessionId, DRAFT, { putTo: "devops" });
    const chat = aThread({ id: randomUUID(), roleKey: "planner" });
    await repository.add(chat);
    const { thread: chatCalling } = await repository.update(chat.id, (latest) =>
      openDecision(latest, { ...DRAFT, id: randomUUID(), askedAt: new Date(), putTo: "devops" }),
    );

    const open = await decisions.listOpen();

    const ids = open.map(({ id }) => id);
    expect(open).toContainEqual(
      expect.objectContaining({ id: onShaping.decision.id, taskId: undefined, initiativeId }),
    );
    expect(open).toContainEqual(
      expect.objectContaining({ id: onPlanning.decision.id, initiativeId }),
    );
    expect(open.filter(({ id }) => id === onTask.decision.id)).toEqual([
      expect.objectContaining({ taskId }),
    ]);
    expect(open.find(({ id }) => id === onTask.decision.id)?.initiativeId).toBeUndefined();
    expect(ids).not.toContain(call.decision.id);
    expect(ids).not.toContain(decisionOf(chatCalling));
    await expect(decisions.openInThread(planning.thread.id)).resolves.toEqual([
      { taskId: undefined, question: expect.any(String) },
      { taskId, question: expect.any(String) },
    ]);
  });

  it("close as the Initiative ends, in its every Thread, leaving those on its Tasks and other Initiatives'", async () => {
    const initiativeId = randomUUID();
    const shaping = await onInitiative(initiativeId, "shaping");
    const planning = await onInitiative(initiativeId, "planning");
    const elsewhere = await onInitiative(randomUUID(), "shaping");
    const taskId = randomUUID();
    const onShaping = await decisions.open(shaping.sessionId, DRAFT);
    const call = await decisions.open(planning.sessionId, DRAFT, { putTo: "devops" });
    const onTask = await decisions.open(planning.sessionId, DRAFT, { taskId });
    const onOther = await decisions.open(elsewhere.sessionId, DRAFT);

    await decisions.closeOnInitiative(initiativeId);

    for (const { decision } of [onShaping, call]) {
      expect(await repository.decision(decision.id)).toMatchObject({
        answer: undefined,
        closedAt: expect.any(Date),
      });
    }
    expect(closed.map(({ decision }) => decision.id)).toEqual(
      expect.arrayContaining([onShaping.decision.id, call.decision.id]),
    );
    expect((await repository.find(planning.thread.id))?.openDecisions.map(({ id }) => id)).toEqual([
      onTask.decision.id,
    ]);
    const open = (await decisions.listOpen()).map(({ id }) => id);
    expect(open).not.toContain(onShaping.decision.id);
    expect(open).toContain(onOther.decision.id);
    await expect(
      decisions.answer(onShaping.decision.id, oneOptionAnswer(0), { kind: "user", user: null }),
    ).rejects.toMatchObject({ reasons: ["This Decision was closed: its Initiative ended."] });
  });
});
