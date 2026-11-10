import { randomUUID } from "node:crypto";
import {
  decisionListSchema,
  messageListSchema,
  proposalSchema,
  threadListSchema,
  threadRefusalSchema,
  threadSchema,
  threadWebEventSchema,
} from "@the-office/contracts";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { CARETAKER, EngineCascade, RoleCards, type SessionRole } from "../../../people/index.js";
import { DecisionService } from "../../application/decision-service.js";
import { aPlannerCard } from "../../application/session-role.fixtures.js";
import { ThreadService } from "../../application/thread-service.js";
import { DecisionAnswered } from "../../domain/conversation-events.js";
import type { Decision } from "../../domain/decision.js";
import { aProposedCard } from "../../domain/proposal.fixtures.js";
import type { Thread } from "../../domain/thread.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { ScriptedEngine, ScriptedEngineModule } from "../../../engine/index.js";
import { EngineCascadeStandIn } from "../../../people/index.fixtures.js";
import { McpServersModule } from "../../../mcp-servers/index.js";
import { SkillsModule } from "../../../skills/index.js";
import { Briefs } from "../../application/briefs.js";
import { sessionMemoryProvider } from "../../application/session-memory.fixtures.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import { LinkCards } from "../../application/link-cards.js";
import { ProposalService } from "../../application/proposal-service.js";
import { SessionPlaces } from "../../application/session-places.js";
import { InitiativeThreadSetups } from "../../application/initiative-thread-setups.js";
import { TaskConversations } from "../../application/task-conversations.js";
import { TaskThreadSetups } from "../../application/task-thread-setups.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { AllowChanges } from "../../application/allow-changes.js";
import { StageThreads } from "../../application/stage-threads.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { MentionedRecords } from "../../application/mentioned-records.js";
import { openPageRecordProviders } from "../../application/open-page-records.fixtures.js";
import { WorkRecords } from "../../application/work-records.js";
import { ProjectBases } from "../../ports/project-bases.js";
import { PostgresThreadRepository } from "../postgres/postgres-thread-repository.js";
import { ThreadWebEvents } from "../websocket/thread-web-events.js";
import { DecisionsController } from "./decisions.controller.js";
import { FireAlarmLiftsController } from "./fire-alarm-lifts.controller.js";
import { ProposalsController } from "./proposals.controller.js";
import { OfficeInstructionsController } from "./office-instructions.controller.js";
import { SizeThresholdController } from "./size-threshold.controller.js";
import { ThreadsController } from "./threads.controller.js";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";
import { ConversationsSettings } from "../../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../../ports/office-instructions-repository.js";
import { OfficeInstructions } from "../../application/office-instructions.js";
import { FireAlarmInThreads } from "../../application/fire-alarm-in-threads.js";
import { FireAlarmLifts } from "../../application/fire-alarm-lifts.js";
import { ApprovalHolds } from "../../application/approval-holds.js";
import { FireAlarmLiftRepository } from "../../ports/fire-alarm-lift-repository.js";
import { PostgresFireAlarmLiftRepository } from "../postgres/postgres-fire-alarm-lift-repository.js";
import { ChangesAllowedRepository } from "../../ports/changes-allowed-repository.js";
import { PostgresChangesAllowedRepository } from "../postgres/postgres-changes-allowed-repository.js";
import { ChatActivity } from "../../application/chat-activity.js";
import { ChatActivityRepository } from "../../ports/chat-activity-repository.js";
import { PostgresChatActivityRepository } from "../postgres/postgres-chat-activity-repository.js";
import { ProjectOutputMasks } from "../../ports/project-output-masks.js";
import { ProjectOutputMasksForTests } from "../../ports/project-output-masks.fixtures.js";

// What threads.controller.test.ts and threads.controller.full.test.ts share.

const outputMasks = new ProjectOutputMasksForTests();

let app: INestApplication;

let url: string;

let officeData: string;

let published: DomainEvent[];

/** The people the chats are with, by Role key: each test hires its own. */
let people: Map<string, SessionRole>;

/** A person of this test's own, with Chat on or off. */
function aPerson(name: string, chat: boolean): string {
  const roleKey = `role-${randomUUID()}`;
  const card = aPlannerCard({
    name,
    capabilities: { sharedMemory: false, chat, consultant: true, runEnvironment: false },
  });
  people.set(roleKey, { roleKey, cardVersion: 1, card });
  return roleKey;
}

/** The events published so far, as the web receives them. */
function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = threadWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return fetch(`${url}/api${path}`);
}

/** A Thread at `home` with a session of its own person, by the session's id. */
async function withSession(
  home: (roleKey: string) => Thread["home"],
  { stageThread = false }: { readonly stageThread?: boolean } = {},
): Promise<{
  readonly thread: Thread;
  readonly sessionId: string;
}> {
  const roleKey = aPerson("Marta", true);
  const sessionId = randomUUID();
  const thread = aThread({
    id: randomUUID(),
    home: home(roleKey),
    roleKey,
    stageThread,
    session: {
      id: sessionId,
      roleKey,
      cardVersion: 1,
      officeInstructionsVersion: 0,
      engineId: "claude-code",
      startedAt: new Date(),
      lastCallAt: new Date(),
      contextTokens: 34_000,
      startContextTokens: 33_000,
      full: false,
      changesAllowed: false,
    },
  });
  await app.get(ThreadRepository).add(thread);
  return { thread, sessionId };
}

/** A chat Thread whose session drafted a Proposal of a new Role, which People would hire. */
async function drafted(): Promise<{ readonly thread: Thread; readonly proposalId: string }> {
  app.get(ProposalAppliers).register("hire", {
    problemsWith: () => Promise.resolve([]),
    apply: (hire) => Promise.resolve({ ...hire, roleKey: "tester" }),
  });
  const { thread, sessionId } = await withSession((roleKey) => ({ kind: "chat", roleKey }));
  const { id } = await app.get(ProposalService).draft(sessionId, {
    kind: "hire",
    card: aProposedCard(),
    skills: [],
    roleKey: undefined,
  });
  return { thread, proposalId: id };
}

/** The hooks every test of both files runs. */
function setUpEachTest(): void {
  beforeEach(async () => {
    people = new Map();
    officeData = await mkdtemp(join(tmpdir(), "office-threads-http-"));
    const roleCards: Pick<RoleCards, "find" | "forResumedSession" | "hiredKeys"> = {
      find: (roleKey) => Promise.resolve(people.get(roleKey)),
      hiredKeys: () => Promise.resolve(new Set(people.keys())),
      forResumedSession: (roleKey) => {
        const person = people.get(roleKey);
        return person ? Promise.resolve(person) : Promise.reject(new Error(`No ${roleKey} here.`));
      },
    };
    const bases: ProjectBases = {
      folder: join(officeData, "bases"),
      list: () => Promise.resolve([]),
      refresh: () => Promise.resolve([]),
    };
    ({ app, url } = await startTestApplication({
      database: true,
      imports: [
        EventsModule,
        EventStreamModule,
        TelemetryModule,
        OfficeDataModule.forRoot(officeData),
        SkillsModule,
        McpServersModule,
        // The runner's own tests answer messages; these send ones it refuses, or no session takes.
        ScriptedEngineModule.register(new ScriptedEngine([])),
      ],
      controllers: [
        ThreadsController,
        DecisionsController,
        ProposalsController,
        SizeThresholdController,
        OfficeInstructionsController,
        FireAlarmLiftsController,
      ],
      providers: [
        { provide: ThreadRepository, useClass: PostgresThreadRepository },
        { provide: RoleCards, useValue: roleCards },
        { provide: EngineCascade, useValue: new EngineCascadeStandIn() },
        { provide: ProjectBases, useValue: bases },
        { provide: ProjectOutputMasks, useValue: outputMasks },
        { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
        { provide: OfficeInstructionsRepository, useClass: OfficeInstructionsRepositoryForTests },
        OfficeInstructions,
        ContextPolicySettingsService,
        ThreadService,
        Briefs,
        sessionMemoryProvider(),
        TaskThreadSetups,
        InitiativeThreadSetups,
        SessionPlaces,
        ThreadContexts,
        AllowChanges,
        ThreadRunner,
        FireAlarmInThreads,
        FireAlarmLifts,
        ApprovalHolds,
        { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
        { provide: ChangesAllowedRepository, useClass: PostgresChangesAllowedRepository },
        { provide: ChatActivityRepository, useClass: PostgresChatActivityRepository },
        ChatActivity,
        MentionedRecords,
        ...openPageRecordProviders(),
        WorkRecords,
        StageThreads,
        DecisionService,
        ProposalAppliers,
        ProposalService,
        LinkCards,
        TaskConversations,
        ThreadWebEvents,
      ],
    }));
    app.get(TaskThreadSetups).provide({
      planner: "planner",
      readyForPersonsThread: () => Promise.resolve(undefined),
      planningThreadElsewhere: () => Promise.resolve(undefined),
      setUp: ({ taskId }) =>
        Promise.resolve({
          folder: join(officeData, "worktrees", taskId),
          environment: {},
          useProjectSkills: false,
          projectSkillsOff: [],
          projectId: "admin-panel",
          instructions: "On this Task you plan.",
          officeTools: [],
          brief: "The Task's record.",
          asking: false,
          sessionRefusal: undefined,
        }),
    });
    published = [];
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  });

  afterEach(async () => {
    await app.close();
    await rm(officeData, { recursive: true, force: true });
  });
}

setUpEachTest();

describe("a person's chat", () => {
  it("starts fresh Threads, lists them newest first and reads each", async () => {
    const roleKey = aPerson("Jan", true);

    const first = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );
    const second = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    expect(first).toMatchObject({
      home: { kind: "chat", roleKey },
      roleKey,
      title: null,
      state: "waiting",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      context: {
        move: "fresh",
        reason: "new-thread",
        cacheWarm: false,
        contextTokens: 0,
        briefTokens: expect.any(Number),
        alternatives: [],
        override: null,
      },
    });
    const listed = threadListSchema.parse(await (await get(`/chats/${roleKey}/threads`)).json());
    expect(listed.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(threadSchema.parse(await (await get(`/threads/${first.id}`)).json())).toEqual(first);
    expect(
      messageListSchema.parse(await (await get(`/threads/${first.id}/messages`)).json()),
    ).toEqual([]);
    expect(webEvents()).toEqual([
      { type: "thread.started", threadId: first.id, home: { kind: "chat", roleKey } },
      { type: "thread.started", threadId: second.id, home: { kind: "chat", roleKey } },
    ]);
  });

  it("refuses a Thread with a person whose Chat is off, and a chat with nobody", async () => {
    const roleKey = aPerson("Ada", false);

    const refused = await send("POST", `/chats/${roleKey}/threads`);
    const nobody = await send("POST", `/chats/role-${randomUUID()}/threads`);

    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Chat is off for Ada: talk to them on a Task, or turn Chat on on their Role card.",
    ]);
    expect(nobody.status).toBe(404);
    expect(published).toEqual([]);
  });
});

describe("a Thread", () => {
  it("answers its log in order, as the web reads it", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );
    const service = app.get(ThreadService);

    const devops = aPerson("Nina", true);
    const taskId = randomUUID();

    await service.log(thread.id, [
      { kind: "user", text: "Read the deploy workflow.", delivery: "delivered" },
      { kind: "tool-activity", roleKey, tool: "Read", summary: "deploy-production.yml" },
      { kind: "refusal", roleKey, tool: "Edit", reason: "A chat only reads." },
      { kind: "mcp-server-not-started", server: "github", reason: undefined },
      { kind: "person", roleKey, text: "It deploys on every push to main." },
      { kind: "link-card", roleKey, to: devops, taskId: undefined, note: "Check the cache." },
      { kind: "link-card", roleKey, to: "gone", taskId, note: "Ask about the Task." },
      {
        kind: "user",
        text: "Check the cache, please.",
        delivery: "delivered",
        handoverNoteFrom: roleKey,
        openPage: { kind: "person", roleKey: devops },
      },
    ]);

    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );
    expect(messages.map(({ id: _id, at: _at, ...message }) => message)).toEqual([
      {
        kind: "user",
        text: "Read the deploy workflow.",
        delivery: "delivered",
        handoverNoteFrom: null,
        openPage: null,
      },
      { kind: "tool-activity", roleKey, tool: "Read", summary: "deploy-production.yml" },
      { kind: "refusal", roleKey, tool: "Edit", reason: "A chat only reads." },
      { kind: "mcp-server-not-started", server: "github", reason: null },
      { kind: "person", roleKey, text: "It deploys on every push to main." },
      {
        kind: "link-card",
        roleKey,
        to: { roleKey: devops, letGo: false },
        taskId: null,
        note: "Check the cache.",
      },
      {
        kind: "link-card",
        roleKey,
        to: { roleKey: "gone", letGo: true },
        taskId,
        note: "Ask about the Task.",
      },
      {
        kind: "user",
        text: "Check the cache, please.",
        delivery: "delivered",
        handoverNoteFrom: roleKey,
        openPage: { kind: "person", roleKey: devops },
      },
    ]);
    const titled = threadSchema.parse(await (await get(`/threads/${thread.id}`)).json());
    expect(titled.title).toBe("Read the deploy workflow");
    expect(webEvents()).toContainEqual({
      type: "thread.messages-logged",
      threadId: thread.id,
      home: { kind: "chat", roleKey },
    });
  });

  it("refuses an empty message, and one to a person whose Chat is now off", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    const empty = await send("POST", `/threads/${thread.id}/messages`, { text: "  " });
    people.set(roleKey, {
      roleKey,
      cardVersion: 2,
      card: aPlannerCard({
        capabilities: { sharedMemory: false, chat: false, consultant: true, runEnvironment: false },
      }),
    });
    const chatOff = await send("POST", `/threads/${thread.id}/messages`, { text: "Hello." });

    expect(empty.status).toBe(422);
    expect(threadRefusalSchema.parse(await empty.json()).reasons).toEqual([
      "Write a message first.",
    ]);
    expect(chatOff.status).toBe(422);
    expect(threadRefusalSchema.parse(await chatOff.json()).reasons[0]).toMatch(
      /^Chat is off for Jan/,
    );
  });

  it("is not found when it isn't there", async () => {
    const response = await get(`/threads/${randomUUID()}`);

    expect(response.status).toBe(404);
  });
});

describe("a Decision", () => {
  const draft = {
    question: "Should the export include archived Projects?",
    context: "Archived Projects have no worktree.",
    options: ["Only active Projects", "Every Project"],
    recommendation: { option: 0, reason: "Archived ones have nothing to export." },
  };

  /** A planning Thread on a Task of its own whose session opened a Decision. */
  async function opened(): Promise<{ readonly thread: Thread; readonly decision: Decision }> {
    const roleKey = aPerson("Jan", false);
    const sessionId = randomUUID();
    const thread = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId: randomUUID() },
      roleKey,
      title: "Planning",
      session: {
        id: sessionId,
        roleKey,
        cardVersion: 1,
        officeInstructionsVersion: 0,
        engineId: "claude-code",
        startedAt: new Date(),
        lastCallAt: new Date(),
        contextTokens: 34_000,
        startContextTokens: 33_000,
        full: false,
        changesAllowed: false,
      },
    });
    await app.get(ThreadRepository).add(thread);
    const decision = await app.get(DecisionService).open(sessionId, draft);
    return { thread, decision };
  }

  it("shows in the Thread's log as its card, and among the open Decisions, as the web reads them", async () => {
    const { thread, decision } = await opened();

    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    const shown = {
      ...draft,
      id: decision.id,
      threadId: thread.id,
      taskId: decision.taskId,
      roleKey: thread.roleKey,
      attachmentIds: [],
      askedAt: decision.askedAt.toISOString(),
      putTo: null,
      passedOn: [],
      answer: null,
      answeredAt: null,
      answeredBy: null,
    };
    expect(open).toContainEqual(shown);
    expect(messages.map(({ id: _id, at: _at, ...message }) => message)).toEqual([
      { kind: "decision", roleKey: thread.roleKey, decision: shown },
    ]);
    expect(webEvents()).toContainEqual({
      type: "thread.decision-opened",
      threadId: thread.id,
      home: thread.home,
      decisionId: decision.id,
    });
  });

  it("refuses a second answer, and shows the first in the log", async () => {
    const { thread, decision } = await opened();
    const answered: Decision = {
      ...decision,
      answer: { kind: "free-answer", text: "Only this year's.", answeredAt: new Date() },
    };
    await app.get(ThreadRepository).update(thread.id, (current) => {
      const waiting = { ...current, openDecision: undefined };
      const line = {
        kind: "decision-answer",
        id: randomUUID(),
        threadId: thread.id,
        at: new Date(),
        decisionId: decision.id,
        answer: { kind: "free-answer", text: "Only this year's." },
      } as const;
      return {
        thread: waiting,
        logged: [line],
        decision: answered,
        event: new DecisionAnswered(waiting, answered, new Date()),
      };
    });

    const again = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "option",
      option: 0,
    });
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    expect(again.status).toBe(422);
    expect(threadRefusalSchema.parse(await again.json()).reasons).toEqual([
      "This Decision is answered already.",
    ]);
    expect(messages.map((message) => message.kind)).toEqual(["decision", "decision-answer"]);
    expect(messages[1]).toMatchObject({
      answer: { kind: "free-answer", text: "Only this year's." },
      decision: { answer: { kind: "free-answer", text: "Only this year's." } },
    });
    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    expect(open.map(({ id }) => id)).not.toContain(decision.id);
  });
});

describe("a Proposal", () => {
  it("shows in the Thread's log as its card, and applies as the user edited it", async () => {
    const { thread, proposalId } = await drafted();

    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );
    const read = proposalSchema.parse(await (await get(`/proposals/${proposalId}`)).json());
    const applying = await send("POST", `/proposals/${proposalId}/apply`, {
      card: { ...aProposedCard(), name: "Tom", skills: [] },
    });

    expect(messages).toEqual([
      {
        kind: "proposal",
        id: expect.any(String),
        at: expect.any(String),
        roleKey: thread.roleKey,
        proposal: read,
      },
    ]);
    expect(read).toMatchObject({
      draftedBy: thread.roleKey,
      change: { kind: "hire", card: { ...aProposedCard(), skills: [] }, roleKey: null },
      status: { kind: "open" },
    });
    expect(applying.status).toBe(200);
    expect(proposalSchema.parse(await applying.json())).toMatchObject({
      change: { kind: "hire", card: { name: "Tom" }, roleKey: "tester" },
      status: { kind: "applied", at: expect.any(String) },
    });
    const names = { threadId: thread.id, home: thread.home, proposalId };
    expect(webEvents()).toEqual([
      { type: "thread.proposal-drafted", ...names },
      { type: "thread.proposal-applied", ...names },
    ]);
  });
});

describe("Allow changes", () => {
  it("is switched on and off in the Caretaker's chat, with a line each time, and refused elsewhere", async () => {
    people.set(CARETAKER, {
      roleKey: CARETAKER,
      cardVersion: 1,
      card: aPlannerCard({ name: "Sam", title: "Caretaker" }),
    });
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${CARETAKER}/threads`)).json(),
    );
    const elsewhere = threadSchema.parse(
      await (await send("POST", `/chats/${aPerson("Jan", true)}/threads`)).json(),
    );

    const allowed = threadSchema.parse(
      await (await send("PUT", `/threads/${thread.id}/allow-changes`)).json(),
    );
    const switchedOff = threadSchema.parse(
      await (await send("DELETE", `/threads/${thread.id}/allow-changes`)).json(),
    );
    const refused = await send("PUT", `/threads/${elsewhere.id}/allow-changes`);
    const log = messageListSchema.parse(await (await get(`/threads/${thread.id}/messages`)).json());

    expect([thread.changesAllowed, allowed.changesAllowed, switchedOff.changesAllowed]).toEqual([
      false,
      true,
      false,
    ]);
    expect(elsewhere.changesAllowed).toBeNull();
    expect(log.map((message) => message.kind === "changes-allowed" && message.allowed)).toEqual([
      true,
      false,
    ]);
    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Only the Caretaker's chat has Allow changes.",
    ]);
    expect((await send("PUT", `/threads/${randomUUID()}/allow-changes`)).status).toBe(404);
  });
});
