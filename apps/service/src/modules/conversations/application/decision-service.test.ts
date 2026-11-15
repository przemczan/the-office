import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { RoleCards } from "../../people/index.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { DecisionClosed } from "../domain/conversation-events.js";
import { DRAFT } from "../domain/decision.fixtures.js";
import type { Thread } from "../domain/thread.js";
import { openDecision } from "../domain/thread-changes.js";
import { aThread } from "../domain/thread.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { DecisionService } from "./decision-service.js";
import { ThreadRunner } from "./thread-runner.js";
import { WorkRecords } from "./work-records.js";

let app: INestApplication;
let repository: PostgresThreadRepository;
let decisions: DecisionService;
const closed: DecisionClosed[] = [];

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule],
    providers: [
      DecisionService,
      PostgresThreadRepository,
      { provide: ThreadRepository, useExisting: PostgresThreadRepository },
      // Closing a Decision needs none of these: it never reaches a session or a Task's record.
      { provide: ThreadRunner, useValue: {} },
      { provide: WorkRecords, useValue: {} },
      { provide: RoleCards, useValue: {} },
    ],
  }));
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
      decisions.answer(
        decisionOf(waiting),
        { kind: "option", option: 0 },
        { kind: "user", user: null },
      ),
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
    await decisions.answer(id, { kind: "option", option: 1 }, { kind: "user", user: null });
    const answered = await repository.decision(id);

    await decisions.closeOnDroppedTask(taskId);

    expect(await repository.decision(id)).toEqual(answered);
    expect(answered?.closedAt).toBeUndefined();
  });
});
