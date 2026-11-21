import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EventBus } from "../../../platform/events/event-bus.js";
import type { RoleCards } from "../../people/index.js";
import {
  AT,
  aThreadOfItsOwn,
  repository,
  setUpEachTest,
} from "../adapters/postgres/postgres-thread-repository.fixtures.js";
import type { Message } from "../domain/message.js";
import type { ProposedChange } from "../domain/proposal.js";
import { applyProposal, declineProposal } from "../domain/proposal-changes.js";
import type { Home, Thread, ThreadSession } from "../domain/thread.js";
import { draftProposal, logMessages, openDecision } from "../domain/thread-changes.js";
import { aUserMessage } from "../domain/thread.fixtures.js";
import { BEN_ITO } from "../domain/user.fixtures.js";
import type { ProposalAppliers } from "./proposal-appliers.js";
import { ProposalService } from "./proposal-service.js";
import type { ThreadRunner } from "./thread-runner.js";
import { ThreadService } from "./thread-service.js";

setUpEachTest();

const NO_EVENTS = { publish: () => Promise.resolve() } as unknown as EventBus;

const SIZE_THRESHOLD: ProposedChange = { kind: "size-threshold", from: 150_000, to: 120_000 };

/** A time of this file's own, `minute` minutes past `AT`. */
const at = (minute: number) => new Date(AT.getTime() + minute * 60_000);

/** A Proposal of `change` drafted at `minute` in the Thread, which is added first. */
async function drafted(thread: Thread, minute: number, change = SIZE_THRESHOLD): Promise<string> {
  const id = randomUUID();
  await repository.update(thread.id, (latest) =>
    draftProposal(latest, { id, draftedAt: at(minute), change }),
  );
  return id;
}

function proposals(): ProposalService {
  return new ProposalService(repository, {} as ProposalAppliers, NO_EVENTS);
}

function threads(): ThreadService {
  return new ThreadService(repository, {} as RoleCards, {} as ThreadRunner, NO_EVENTS);
}

describe("ProposalService.waitingOnTheUser", () => {
  it("lists every open Proposal with its Thread's home, the oldest first, naming a skill update", async () => {
    const roleKey = `role-${randomUUID()}`;
    const onTask: Home = { kind: "task", taskId: randomUUID() };
    const onInitiative: Home = { kind: "initiative", initiativeId: randomUUID() };
    const chat = aThreadOfItsOwn(roleKey);
    const taskThread = aThreadOfItsOwn(roleKey, { home: onTask });
    const initiativeThread = aThreadOfItsOwn(roleKey, { home: onInitiative });
    for (const thread of [chat, taskThread, initiativeThread]) await repository.add(thread);
    const skillUpdate: ProposedChange = {
      kind: "skill-update",
      name: "release-notes",
      repository: "https://example.com/skills.git",
      folder: "skills/release-notes",
      from: { tag: "v1.0.0", commit: "a".repeat(40) },
      to: { tag: "v1.1.0", commit: "b".repeat(40) },
      notes: "Shorter notes.",
      files: ["SKILL.md"],
      filesHash: "hash",
    };
    const inTask = await drafted(taskThread, 2);
    const inChat = await drafted(chat, 1, skillUpdate);
    const inInitiative = await drafted(initiativeThread, 3);
    const applied = await drafted(chat, 4);
    const declined = await drafted(taskThread, 5);
    await repository.updateProposal(applied, (stored) =>
      Promise.resolve(applyProposal(stored, chat, stored.change, at(6), BEN_ITO)),
    );
    await repository.updateProposal(declined, (stored) =>
      Promise.resolve(declineProposal(stored, taskThread, at(6), BEN_ITO)),
    );

    const waiting = (await proposals().waitingOnTheUser()).filter(
      ({ draftedBy }) => draftedBy === roleKey,
    );

    expect(waiting).toEqual([
      {
        id: inChat,
        threadId: chat.id,
        draftedBy: roleKey,
        draftedAt: at(1),
        home: { kind: "chat", roleKey },
        skillUpdate: "release-notes",
      },
      {
        id: inTask,
        threadId: taskThread.id,
        draftedBy: roleKey,
        draftedAt: at(2),
        home: onTask,
        skillUpdate: undefined,
      },
      {
        id: inInitiative,
        threadId: initiativeThread.id,
        draftedBy: roleKey,
        draftedAt: at(3),
        home: onInitiative,
        skillUpdate: undefined,
      },
    ]);
  });
});

/** A session the shaper's Thread has once they first answered. */
function aSession(roleKey: string): ThreadSession {
  return {
    id: randomUUID(),
    roleKey,
    cardVersion: 1,
    officeInstructionsVersion: 0,
    engineId: "claude-code",
    startedAt: AT,
    lastCallAt: AT,
    contextTokens: 0,
    startContextTokens: undefined,
    full: false,
    changesAllowed: false,
  };
}

/** The shaper's Thread on a new Initiative, started `minute` minutes past `AT`, with a session. */
async function aShapingThread(
  initiativeId: string = randomUUID(),
  minute = 0,
  fields: Partial<Thread> = {},
): Promise<Thread> {
  const thread = aThreadOfItsOwn("shaper", {
    home: { kind: "initiative", initiativeId },
    startedAt: at(minute),
    session: aSession("shaper"),
    ...fields,
  });
  await repository.add(thread);
  return thread;
}

async function userWrites(thread: Thread, minute: number): Promise<void> {
  const message = { ...aUserMessage(thread, "Who is it for?"), at: at(minute) };
  await repository.update(thread.id, (latest) => logMessages(latest, [message], at(minute)));
}

async function shaperAnswers(thread: Thread, minute: number): Promise<void> {
  const message: Message = {
    kind: "person",
    id: randomUUID(),
    threadId: thread.id,
    roleKey: thread.roleKey,
    text: "For the support team.",
    at: at(minute),
  };
  await repository.update(thread.id, (latest) => logMessages(latest, [message], at(minute)));
}

function initiativeOf(thread: Thread): string {
  if (thread.home.kind !== "initiative") throw new Error("Not on an Initiative.");
  return thread.home.initiativeId;
}

describe("ThreadService.waitingForReply", () => {
  it("lists an Initiative once its shaper answered, until the user replies or a Decision waits, in its newest Thread alone", async () => {
    const answered = await aShapingThread();
    await userWrites(answered, 1);
    await shaperAnswers(answered, 2);
    const replied = await aShapingThread();
    await shaperAnswers(replied, 1);
    await userWrites(replied, 2);
    const asking = await aShapingThread();
    await shaperAnswers(asking, 1);
    await repository.update(asking.id, (latest) =>
      openDecision(latest, {
        id: randomUUID(),
        context: "The outcome is open.",
        questions: [{ kind: "open", question: "Who is it for?" }],
        askedAt: at(2),
      }),
    );
    const replaced = await aShapingThread();
    await shaperAnswers(replaced, 1);
    await aShapingThread(initiativeOf(replaced), 2, { session: undefined });
    const consulted = await aShapingThread();
    await shaperAnswers(consulted, 1);
    await aShapingThread(initiativeOf(consulted), 2, {
      roleKey: "devops",
      consultation: {
        decisionId: randomUUID(),
        askerThreadId: consulted.id,
        askerRoleKey: "shaper",
      },
    });
    const notAsked = await aShapingThread();
    await shaperAnswers(notAsked, 1);

    const waiting = await threads().waitingForReply(
      [answered, replied, asking, replaced, consulted].map(initiativeOf),
    );

    expect(waiting.toSorted((one, other) => (one.threadId > other.threadId ? 1 : -1))).toEqual(
      [
        { initiativeId: initiativeOf(answered), threadId: answered.id, answeredAt: at(2) },
        { initiativeId: initiativeOf(consulted), threadId: consulted.id, answeredAt: at(1) },
      ]
        .map((reply) => ({ ...reply, roleKey: "shaper" }))
        .toSorted((one, other) => (one.threadId > other.threadId ? 1 : -1)),
    );
    await expect(threads().waitingForReply([])).resolves.toEqual([]);
  });
});
