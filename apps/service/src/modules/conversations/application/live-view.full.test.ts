import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EngineModels, FIRST_CLAUDE_CODE_ENGINE } from "../../engine/index.js";
import {
  RoleCards,
  RoleHired,
  RoleHiredBack,
  RoleLetGo,
  type HiredPerson,
} from "../../people/index.js";
import { aRole } from "../../people/index.fixtures.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { LiveViewChanged, TurnEnded } from "../domain/conversation-events.js";
import type { LivePerson } from "../domain/live-view.js";
import type { Message } from "../domain/message.js";
import type { Thread, ThreadSession } from "../domain/thread.js";
import { closeDecision, logMessages, openDecision } from "../domain/thread-changes.js";
import { aThread, aUserMessage } from "../domain/thread.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { LiveView } from "./live-view.js";

const HIRED = new Date("2026-11-01T09:00:00.000Z");
const ASKED = new Date("2026-11-05T09:00:00.000Z");
const TURN_ENDED = new Date("2026-11-05T09:05:00.000Z");

let app: INestApplication;
let liveView: LiveView;
let repository: ThreadRepository;
let events: EventBus;
/** The people hired here, under keys of this test's own: every test file shares the database. */
let people: HiredPerson[];
let oscar: HiredPerson;
let announced: LiveViewChanged[];

beforeEach(async () => {
  oscar = {
    roleKey: `developer-${randomUUID()}`,
    name: "Oscar",
    title: "Developer",
    hiredAt: HIRED,
  };
  people = [oscar];
  const roleCards: Pick<RoleCards, "hiredPeople"> = {
    hiredPeople: () => Promise.resolve([...people]),
  };
  const engineModels: Pick<EngineModels, "engines"> = {
    engines: () =>
      Promise.resolve([
        { ...FIRST_CLAUDE_CODE_ENGINE, id: "claude-code", name: "Claude Code" },
        { ...FIRST_CLAUDE_CODE_ENGINE, id: "codex", name: "Codex" },
      ]),
  };
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: EngineModels, useValue: engineModels },
      LiveView,
    ],
  }));
  liveView = app.get(LiveView);
  repository = app.get(ThreadRepository);
  events = app.get(EventBus);
  announced = [];
  events.subscribe(LiveViewChanged, (event) => void announced.push(event));
});

afterEach(async () => {
  await app.close();
});

/** Saves what `change` makes of the Thread and publishes its event, as the Conversations services do. */
async function changed<Event extends DomainEvent>(
  thread: Thread,
  change: (latest: Thread) => { readonly thread: Thread; readonly event: Event } | undefined,
): Promise<Thread> {
  const update = await repository.update(thread.id, (latest) => {
    const made = change(latest);
    return made && { logged: [], ...made };
  });
  if (update.event) await events.publish(update.event);
  return update.thread;
}

/** Oscar as the last announcement shows him. */
async function lastAnnounced(): Promise<LivePerson | undefined> {
  return vi.waitFor(() => {
    const last = announced.at(-1);
    if (!last) throw new Error("Nothing was announced.");
    return last.liveView.people.find(({ roleKey }) => roleKey === oscar.roleKey);
  });
}

function aSession(lastCallAt: Date): ThreadSession {
  return {
    id: randomUUID(),
    roleKey: oscar.roleKey,
    cardVersion: 1,
    officeInstructionsVersion: 0,
    engineId: "claude-code",
    startedAt: ASKED,
    lastCallAt,
    contextTokens: 30_000,
    startContextTokens: 30_000,
    full: false,
    changesAllowed: false,
  };
}

async function oscarsChat(): Promise<Thread> {
  const thread = aThread({
    id: randomUUID(),
    home: { kind: "chat", roleKey: oscar.roleKey },
    roleKey: oscar.roleKey,
  });
  await repository.add(thread);
  return thread;
}

/** The user's message starts the turn, as the runner logs it. */
async function turnStarted(thread: Thread): Promise<Thread> {
  return changed(thread, (latest) =>
    logMessages({ ...latest, state: "answering" }, [aUserMessage(latest, "Hello.")], ASKED),
  );
}

function personText(thread: Thread, text: string): Message {
  return {
    kind: "person",
    roleKey: oscar.roleKey,
    text,
    id: randomUUID(),
    threadId: thread.id,
    at: ASKED,
  };
}

describe("the Live view's read model", () => {
  it("announces nothing before the first read", async () => {
    await turnStarted(await oscarsChat());
    people.push({ ...oscar, roleKey: `cto-${randomUUID()}` });
    await events.publish(new RoleHired(aRole()));

    expect(announced).toEqual([]);
  });

  it("announces nothing after the first read for a change event that changes nothing", async () => {
    await liveView.read();
    const clara = { ...oscar, roleKey: `cto-${randomUUID()}`, name: "Clara", title: "CTO" };

    await events.publish(new RoleHired(aRole()));
    people.push(clara);
    await events.publish(new RoleHired(aRole({ key: clara.roleKey })));
    await vi.waitFor(() => expect(announced).toHaveLength(1));

    expect(announced[0]?.liveView.people.map(({ roleKey }) => roleKey)).toEqual([
      oscar.roleKey,
      clara.roleKey,
    ]);
  });

  it("shows a person in a running chat turn working, and idle since the turn's end after it", async () => {
    await liveView.read();
    const chat = await oscarsChat();

    const answering = await turnStarted(chat);
    const working = await lastAnnounced();
    await changed(answering, (latest) => {
      const waiting = { ...latest, state: "waiting" as const, session: aSession(TURN_ENDED) };
      return { thread: waiting, event: new TurnEnded(waiting, TURN_ENDED) };
    });
    await vi.waitFor(() => expect(announced).toHaveLength(2));

    expect(working).toMatchObject({
      state: "working",
      agents: [
        {
          threadId: chat.id,
          home: chat.home,
          kind: "thread",
          consultation: undefined,
          engine: undefined,
        },
      ],
      idleSince: undefined,
    });
    expect(await lastAnnounced()).toMatchObject({
      state: "idle",
      agents: [],
      idleSince: TURN_ENDED,
    });
  });

  it("shows the engine an Agent's session runs on, and the cascade's engine its stand-in runs for", async () => {
    const standInFor = { engineId: "claude-code", engineName: "Claude Code", reason: "used up" };
    const onStandIn = await oscarsChat();
    await changed(onStandIn, (latest) =>
      logMessages(
        {
          ...latest,
          state: "answering",
          session: { ...aSession(ASKED), engineId: "codex", standInFor },
        },
        [aUserMessage(latest, "Hello.")],
        ASKED,
      ),
    );
    const onRemoved = await oscarsChat();
    await changed(onRemoved, (latest) =>
      logMessages(
        { ...latest, state: "answering", session: { ...aSession(ASKED), engineId: "gone" } },
        [aUserMessage(latest, "Hello.")],
        ASKED,
      ),
    );

    const view = await liveView.read();

    const agents = view.people.find(({ roleKey }) => roleKey === oscar.roleKey)?.agents ?? [];
    expect(agents.find(({ threadId }) => threadId === onStandIn.id)?.engine).toEqual({
      engineId: "codex",
      engineName: "Codex",
      standInFor,
    });
    expect(agents.find(({ threadId }) => threadId === onRemoved.id)?.engine).toEqual({
      engineId: "gone",
      engineName: "gone",
      standInFor: undefined,
    });
  });

  it("announces no messages logged inside a running turn", async () => {
    await liveView.read();
    const answering = await turnStarted(await oscarsChat());
    await vi.waitFor(() => expect(announced).toHaveLength(1));
    const busyReads = vi.spyOn(repository, "busy");

    await changed(answering, (latest) =>
      logMessages(latest, [personText(latest, "Looking."), personText(latest, "Found it.")], ASKED),
    );

    expect(busyReads).not.toHaveBeenCalled();
    expect(announced).toHaveLength(1);
  });

  it("shows a Decision opened as waiting on you, and clears it once it is closed", async () => {
    await liveView.read();
    const thread = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId: randomUUID() },
      roleKey: oscar.roleKey,
      stageThread: true,
    });
    await repository.add(thread);
    const decisionId = randomUUID();

    const waiting = await changed(thread, (latest) =>
      openDecision(latest, {
        id: decisionId,
        context: "The run environment needs one.",
        questions: [
          {
            kind: "choice",
            question: "Which Postgres version?",
            options: ["16", "17"],
            recommendation: { option: 1, reason: "The newest is supported longest." },
          },
        ],
        askedAt: ASKED,
      }),
    );
    const opened = await lastAnnounced();
    await changed(waiting, (latest) => closeDecision(latest, decisionId, TURN_ENDED));
    await vi.waitFor(() => expect(announced).toHaveLength(2));

    expect(opened).toMatchObject({
      state: "waiting-on-you",
      waitingOnYou: [{ decisionId, threadId: thread.id, byTheOffice: false, since: ASKED }],
    });
    expect(await lastAnnounced()).toMatchObject({ state: "idle", waitingOnYou: [] });
  });

  it("announces a planner's turn starting and ending in an Initiative's Thread while its Decision waits", async () => {
    await liveView.read();
    const thread = aThread({
      id: randomUUID(),
      home: { kind: "initiative", initiativeId: randomUUID() },
      roleKey: oscar.roleKey,
    });
    await repository.add(thread);
    const waiting = await changed(thread, (latest) =>
      openDecision(latest, {
        id: randomUUID(),
        taskId: randomUUID(),
        context: "Both can start.",
        questions: [
          {
            kind: "choice",
            question: "Which Project first?",
            options: ["Service", "Web"],
            recommendation: { option: 1, reason: "The web reads the service." },
          },
        ],
        askedAt: ASKED,
      }),
    );
    await vi.waitFor(() => expect(announced).toHaveLength(1));

    const answering = await turnStarted(waiting);
    await vi.waitFor(() => expect(announced).toHaveLength(2));
    const working = await lastAnnounced();
    await changed(answering, (latest) =>
      logMessages({ ...latest, state: "waiting" }, [personText(latest, "Planned.")], TURN_ENDED),
    );
    await vi.waitFor(() => expect(announced).toHaveLength(3));

    expect(working).toMatchObject({ state: "waiting-on-you", agents: [{ threadId: thread.id }] });
    expect(await lastAnnounced()).toMatchObject({ state: "waiting-on-you", agents: [] });
  });

  it("announces a hire, a let-go and a hire back once each, and nothing when the view is unchanged", async () => {
    await liveView.read();
    const clara = { ...oscar, roleKey: `cto-${randomUUID()}`, name: "Clara", title: "CTO" };
    const keysAnnounced = () =>
      announced.map(({ liveView: { people: listed } }) =>
        listed
          .map(({ roleKey }) => roleKey)
          .filter((key) => [oscar.roleKey, clara.roleKey].includes(key)),
      );

    people.push(clara);
    await events.publish(new RoleHired(aRole({ key: clara.roleKey })));
    await vi.waitFor(() => expect(announced).toHaveLength(1));
    people.splice(people.indexOf(clara), 1);
    await events.publish(new RoleLetGo(aRole({ key: clara.roleKey }), TURN_ENDED));
    await vi.waitFor(() => expect(announced).toHaveLength(2));
    await events.publish(new RoleLetGo(aRole({ key: clara.roleKey }), TURN_ENDED));
    people.push(clara);
    await events.publish(new RoleHiredBack(aRole({ key: clara.roleKey }), TURN_ENDED));
    await vi.waitFor(() => expect(announced).toHaveLength(3));

    expect(keysAnnounced()).toEqual([
      [oscar.roleKey, clara.roleKey],
      [oscar.roleKey],
      [oscar.roleKey, clara.roleKey],
    ]);
  });
});
