import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { RoleCards } from "../../people/index.js";
import {
  AT,
  aThreadOfItsOwn,
  repository,
  setUpEachTest,
} from "../adapters/postgres/postgres-thread-repository.fixtures.js";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionReopened,
} from "../domain/conversation-events.js";
import type { Decision } from "../domain/decision.js";
import type { Message } from "../domain/message.js";
import type { ProposedChange } from "../domain/proposal.js";
import { applyProposal, declineProposal } from "../domain/proposal-changes.js";
import type { Home, Thread, ThreadSession } from "../domain/thread.js";
import {
  closeDecision,
  draftProposal,
  logMessages,
  openDecision,
} from "../domain/thread-changes.js";
import { aUserMessage } from "../domain/thread.fixtures.js";
import { BEN_ITO } from "../domain/user.fixtures.js";
import { ClosedConsultationProposals } from "./closed-consultation-proposals.js";
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

/** The Proposals use cases with appliers that carry out every change as drafted. */
function applyingProposals(): ProposalService {
  const appliers = { apply: (change: ProposedChange) => Promise.resolve(change) };
  return new ProposalService(repository, appliers as unknown as ProposalAppliers, NO_EVENTS);
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

/**
 * An Agent's Thread on a new Task with a Decision put to Devops, and Consultations on it: Devops'
 * own, which waits on them, and Angela's, who passed it on to Devops. With `closed`, the Decision
 * is closed, so neither waits on its Consultant.
 */
async function consultationsOnATask(closed = false): Promise<{
  readonly waiting: Thread;
  readonly passedOn: Thread;
}> {
  const home: Home = { kind: "task", taskId: randomUUID() };
  const asker = aThreadOfItsOwn("developer", { home, stageThread: true });
  await repository.add(asker);
  const decisionId = randomUUID();
  await repository.update(asker.id, (latest) =>
    openDecision(latest, {
      id: decisionId,
      context: "The commands aren't set.",
      questions: [{ kind: "open", question: "Set them up?" }],
      askedAt: at(0),
      putTo: "devops",
    }),
  );
  if (closed)
    await repository.update(asker.id, (latest) => closeDecision(latest, decisionId, at(9)));
  const consultation = { decisionId, askerThreadId: asker.id, askerRoleKey: "developer" };
  const waiting = aThreadOfItsOwn("devops", { home, consultation });
  const passedOn = aThreadOfItsOwn("angela", { home, consultation });
  for (const thread of [waiting, passedOn]) await repository.add(thread);
  return { waiting, passedOn };
}

/** A Consultation in Devops' chat, for a call from a chat, whose Decision is gone. */
async function aConsultationInAChat(): Promise<Thread> {
  const consultation = {
    decisionId: randomUUID(),
    askerThreadId: randomUUID(),
    askerRoleKey: "pam",
  };
  const thread = aThreadOfItsOwn("devops", { consultation });
  await repository.add(thread);
  return thread;
}

describe("a Proposal drafted in a Consultation on a Task", () => {
  it("waits on the user while the Consultation waits on its Consultant, and never once it closed", async () => {
    const { waiting, passedOn } = await consultationsOnATask();
    const closed = await consultationsOnATask(true);
    const inChat = await aConsultationInAChat();
    const inOpen = await drafted(waiting, 1);
    const inPassedOn = await drafted(passedOn, 2);
    const inClosed = await drafted(closed.waiting, 3);
    const inChatConsultation = await drafted(inChat, 4);

    const listed = new Set((await proposals().waitingOnTheUser()).map(({ id }) => id));

    expect(listed.has(inOpen)).toBe(true);
    expect(listed.has(inChatConsultation)).toBe(true);
    expect(listed.has(inPassedOn)).toBe(false);
    expect(listed.has(inClosed)).toBe(false);
  });

  it("is declined by The Office once its Consultation closed, saying so, and the rest stay open", async () => {
    const { waiting, passedOn } = await consultationsOnATask();
    const closed = await consultationsOnATask(true);
    const inChat = await aConsultationInAChat();
    const inOpen = await drafted(waiting, 1);
    const inPassedOn = await drafted(passedOn, 2);
    const inClosed = await drafted(closed.waiting, 3);
    const inChatConsultation = await drafted(inChat, 4);

    await proposals().declineInClosedConsultations();

    for (const id of [inPassedOn, inClosed]) {
      expect((await repository.proposal(id))?.status).toEqual({
        kind: "declined",
        at: expect.any(Date),
        by: null,
        because: { kind: "consultation-closed" },
      });
    }
    for (const id of [inOpen, inChatConsultation]) {
      expect((await repository.proposal(id))?.status).toEqual({ kind: "open" });
    }
  });
});

describe("ClosedConsultationProposals", () => {
  it("declines them as a Decision is answered, closed or passed on, and at each start", async () => {
    const events = new EventBus();
    const proposalService = {
      declineInClosedConsultations: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
    const closing = new ClosedConsultationProposals(
      proposalService as unknown as ProposalService,
      events,
    );
    closing.onModuleInit();
    const asker = aThreadOfItsOwn("developer");
    const decision = { id: randomUUID() } as Decision;

    await closing.onApplicationBootstrap();
    await events.publish(new DecisionAnswered(asker, decision, at(1)));
    await events.publish(new DecisionClosed(asker, decision, at(2)));
    await events.publish(new DecisionReopened(asker, decision, at(3)));

    expect(proposalService.declineInClosedConsultations).toHaveBeenCalledTimes(4);
  });
});

/** A new text for the prompt template `key`. */
function ofTemplate(key: string, to: string): ProposedChange {
  return { kind: "prompt-template", key, name: "The brief", from: "Old text.", to };
}

describe("applying a Proposal", () => {
  it("declines the older open Proposals of the same thing as superseded, and no other", async () => {
    const thread = aThreadOfItsOwn("caretaker");
    await repository.add(thread);
    const key = `template-${randomUUID()}`;
    const older = await drafted(thread, 1, ofTemplate(key, "First try."));
    const ofAnother = await drafted(thread, 2, ofTemplate(`template-${randomUUID()}`, "Other."));
    const applied = await drafted(thread, 3, ofTemplate(key, "Second try."));
    const newer = await drafted(thread, 4, ofTemplate(key, "Third try."));

    await applyingProposals().apply(applied, BEN_ITO);

    expect((await repository.proposal(older))?.status).toEqual({
      kind: "declined",
      at: expect.any(Date),
      by: null,
      because: { kind: "superseded", proposalId: applied },
    });
    for (const id of [ofAnother, newer]) {
      expect((await repository.proposal(id))?.status).toEqual({ kind: "open" });
    }
  });

  it("declines an older Proposal of a Project's commands only when it changes some of the same", async () => {
    const thread = aThreadOfItsOwn("devops");
    await repository.add(thread);
    const projectId = randomUUID();
    const ofTestAndLint = await drafted(thread, 1, ofCommands(projectId, ["test", "lint"]));
    const ofBuild = await drafted(thread, 2, ofCommands(projectId, ["build"]));
    const applied = await drafted(thread, 3, ofCommands(projectId, ["test"]));

    await applyingProposals().apply(applied, BEN_ITO);

    expect((await repository.proposal(ofTestAndLint))?.status).toMatchObject({
      kind: "declined",
      because: { kind: "superseded", proposalId: applied },
    });
    expect((await repository.proposal(ofBuild))?.status).toEqual({ kind: "open" });
  });
});

/** New commands `keys` for Project `projectId`. */
function ofCommands(projectId: string, keys: readonly string[]): ProposedChange {
  return {
    kind: "project-commands",
    projectId,
    changes: {
      commands: keys.map((key) => ({
        key,
        from: null,
        to: { name: key, kind: "test", commandLine: `npm run ${key}`, rerunCommandLine: "" },
      })),
    },
  };
}

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
