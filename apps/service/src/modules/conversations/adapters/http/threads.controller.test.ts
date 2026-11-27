import { randomUUID } from "node:crypto";
import { ContractMessageImageRules } from "./contract-message-image-rules.js";
import { MessageImageRules } from "../../ports/message-image-rules.js";
import { MessageImages } from "../../application/message-images.js";
import { ThreadImages } from "../../application/thread-images.js";
import {
  MESSAGE_IMAGE_BYTES,
  MESSAGE_IMAGES_TOTAL_BYTES,
  messageImageSchema,
  chatThreadPageSchema,
  decisionListSchema,
  messageListSchema,
  proposalSchema,
  taskThreadPageSchema,
  threadListSchema,
  threadRefusalSchema,
  threadSchema,
  threadWebEventSchema,
} from "@the-office/contracts";
import type { Pool } from "pg";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { DATABASE_POOL } from "../../../../platform/database/database-pool.js";
import {
  CARETAKER,
  EngineCascade,
  hardSwitchesOf,
  RoleCards,
  sessionRole,
  type SessionRole,
} from "../../../people/index.js";
import { BusyWorkModule } from "../../../busy-work/index.js";
import { DecisionService } from "../../application/decision-service.js";
import { aPlannerCard } from "../../application/session-role.fixtures.js";
import { ThreadService } from "../../application/thread-service.js";
import { DecisionAnswered } from "../../domain/conversation-events.js";
import { oneWordsAnswer, type Decision, type DecisionDraft } from "../../domain/decision.js";
import { aProposedCard } from "../../domain/proposal.fixtures.js";
import type { Thread } from "../../domain/thread.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Module,
  RequestMethod,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { uploadBody } from "../../../../platform/http/upload-body.js";
import { MessageImagesInMemory } from "../../application/message-images.fixtures.js";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { ScheduleModule } from "../../../../platform/schedule/schedule.module.js";
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
import { dutiesProvider } from "../../application/duties.fixtures.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import { LinkCards } from "../../application/link-cards.js";
import { ProposalService } from "../../application/proposal-service.js";
import { SessionPlaces } from "../../application/session-places.js";
import { CallChains } from "../../application/call-chains.js";
import { InitiativeThreadSetups } from "../../application/initiative-thread-setups.js";
import { TaskConversations } from "../../application/task-conversations.js";
import { TaskThreadSetups } from "../../application/task-thread-setups.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { ThreadSummaries } from "../../application/thread-summaries.js";
import { AllowChanges } from "../../application/allow-changes.js";
import { StageThreads } from "../../application/stage-threads.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { MentionedRecords } from "../../application/mentioned-records.js";
import { openPageRecordProviders } from "../../application/open-page-records.fixtures.js";
import { WorkRecords } from "../../application/work-records.js";
import { NO_WORK_RECORDS, taskSubjectsAs } from "../../application/work-records.fixtures.js";
import { ProjectBases } from "../../ports/project-bases.js";
import { noProjectBases } from "../../ports/project-bases.fixtures.js";
import { PostgresThreadRepository } from "../postgres/postgres-thread-repository.js";
import { ThreadWebEvents } from "../websocket/thread-web-events.js";
import { DecisionsController } from "./decisions.controller.js";
import { BugTaskDecisions } from "../../application/bug-task-decisions.js";
import { FireAlarmLiftsController } from "./fire-alarm-lifts.controller.js";
import { ProposalsController } from "./proposals.controller.js";
import { OfficeInstructionsController } from "./office-instructions.controller.js";
import { SizeThresholdController } from "./size-threshold.controller.js";
import { ConversationsSettingsOfficeActions } from "../office-actions/conversations-settings-office-actions.js";
import { ConversationsSettingsOfficeActionsController } from "./conversations-settings-office-actions.controller.js";
import { THREAD_IMAGE_UPLOAD_ROUTE, ThreadsController } from "./threads.controller.js";
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
import { SubAgentsAndProcesses } from "../../application/sub-agents-and-processes.js";
import { SessionStops } from "../../application/session-stops.js";
import { SubAgentAndProcessRepository } from "../../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../postgres/postgres-sub-agent-and-process-repository.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../../people/index.fixtures.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import {
  ANOTHER_SIGNED_IN_FOR_TESTS,
  signedInAs,
} from "../../../../platform/http/signed-in-requests.fixtures.js";
import { ConversationsPromptTemplatesForTests } from "../prompt-templates/conversations-prompt-templates.fixtures.js";

// What threads.controller.test.ts and threads.controller.full.test.ts share.

const outputMasks = new ProjectOutputMasksForTests();

let app: INestApplication;

let url: string;

let officeData: string;

let published: DomainEvent[];

/** The images pasted into the tests' Threads, as Work keeps them. */
let messageImages: MessageImagesInMemory;

/** Reads an image's upload body as ConversationsModule does. */
@Module({})
class ImageUploadsForTests implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(MESSAGE_IMAGES_TOTAL_BYTES))
      .forRoutes({ path: THREAD_IMAGE_UPLOAD_ROUTE, method: RequestMethod.POST });
  }
}

/** The people the chats are with, by Role key: each test hires its own. */
let people: Map<string, SessionRole>;

/** A person of this test's own, with Chat on or off. */
function aPerson(name: string, chat: boolean): string {
  const roleKey = `role-${randomUUID()}`;
  const card = aPlannerCard({
    name,
    capabilities: { sharedMemory: false, chat, consultant: true, runEnvironment: false },
  });
  people.set(roleKey, sessionRole(roleKey, 1, card, MCP_TOOL_DEFAULT_STAND_IN));
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

/** A request signed in by Ann Lee, or by the user `headers` name with `signedInAs`. */
function send(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
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
    const bases = noProjectBases(join(officeData, "bases"));
    ({ app, url } = await startTestApplication({
      database: true,
      imports: [
        ConversationsPromptTemplatesForTests,
        EventsModule,
        ScheduleModule,
        BusyWorkModule,
        EventStreamModule,
        TelemetryModule,
        OfficeDataModule.forRoot(officeData),
        SkillsModule,
        McpServersModule,
        ImageUploadsForTests,
        // The runner's own tests answer messages; these send ones it refuses, or no session takes.
        ScriptedEngineModule.register(new ScriptedEngine([])),
      ],
      controllers: [
        ThreadsController,
        DecisionsController,
        ProposalsController,
        SizeThresholdController,
        OfficeInstructionsController,
        ConversationsSettingsOfficeActionsController,
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
        ConversationsSettingsOfficeActions,
        ContextPolicySettingsService,
        ThreadService,
        Briefs,
        MessageImages,
        ThreadImages,
        { provide: MessageImageRules, useClass: ContractMessageImageRules },
        sessionMemoryProvider(),
        dutiesProvider(),
        TaskThreadSetups,
        InitiativeThreadSetups,
        SessionPlaces,
        CallChains,
        ThreadContexts,
        ThreadSummaries,
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
        {
          provide: SubAgentAndProcessRepository,
          useClass: PostgresSubAgentAndProcessRepository,
        },
        SubAgentsAndProcesses,
        SessionStops,
        DecisionService,
        BugTaskDecisions,
        ProposalAppliers,
        ProposalService,
        LinkCards,
        TaskConversations,
        ThreadWebEvents,
      ],
    }));
    app.get(TaskThreadSetups).provide({
      planner: () => Promise.resolve("planner"),
      readyForPersonsThread: () => Promise.resolve(undefined),
      planningThreadElsewhere: () => Promise.resolve(undefined),
      setUp: ({ taskId }) =>
        Promise.resolve({
          folder: join(officeData, "worktrees", taskId),
          environment: {},
          useProjectSkills: false,
          projectSkillsOff: [],
          projectId: "admin-panel",
          initiativeId: undefined,
          projectName: "Admin panel",
          pipelineName: "",
          instructions: "On this Task you plan.",
          officeTools: [],
          brief: "The Task's record.",
          asking: false,
          sessionRefusal: undefined,
        }),
    });
    messageImages = new MessageImagesInMemory();
    app.get(MessageImages).provide(messageImages);
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
    const listed = chatThreadPageSchema.parse(
      await (await get(`/chats/${roleKey}/threads`)).json(),
    );
    expect(listed.rows.map(({ id }) => id)).toEqual([second.id, first.id]);
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

/** `count` Threads of the person's at `home`, each with a session, a minute apart. */
async function threadsOf(
  roleKey: string,
  home: () => Thread["home"],
  count: number,
): Promise<readonly Thread[]> {
  const threads = Array.from({ length: count }, (_, minute) =>
    aThread({
      id: randomUUID(),
      home: home(),
      roleKey,
      title: `Thread ${minute}`,
      startedAt: new Date(Date.UTC(2026, 9, 25, 9, minute)),
      session: {
        id: randomUUID(),
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
    }),
  );
  for (const thread of threads) await app.get(ThreadRepository).add(thread);
  return threads;
}

function onATask(): Thread["home"] {
  return { kind: "task", taskId: randomUUID() };
}

/** What builds a Brief or reads a Thread's log, which no list may do. */
function spyOnBriefsAndLogs() {
  return [
    vi.spyOn(app.get(Briefs), "forThread"),
    vi.spyOn(app.get(Briefs), "forTaskThread"),
    vi.spyOn(app.get(TaskThreadSetups), "of"),
    vi.spyOn(app.get(ThreadRepository), "messages"),
  ];
}

/** How many queries the database is sent while `read` runs. */
async function queriesWhile(read: () => Promise<unknown>): Promise<number> {
  const pool = app.get<Pool>(DATABASE_POOL, { strict: false });
  const query = vi.spyOn(pool, "query");
  await read();
  const count = query.mock.calls.length;
  query.mockRestore();
  return count;
}

describe("a person's lists of Threads", () => {
  it("pages the chat, newest first, 30 at a time with the total, building no Brief", async () => {
    const roleKey = aPerson("Jan", true);
    const threads = await threadsOf(roleKey, () => ({ kind: "chat", roleKey }), 32);
    const spies = spyOnBriefsAndLogs();

    const first = chatThreadPageSchema.parse(await (await get(`/chats/${roleKey}/threads`)).json());
    const next = await get(`/chats/${roleKey}/threads?after=${first.next ?? ""}`);
    const second = chatThreadPageSchema.parse(await next.json());

    const newestFirst = threads.toReversed().map(({ id }) => id);
    expect(first.rows.map(({ id }) => id)).toEqual(newestFirst.slice(0, 30));
    expect(second.rows.map(({ id }) => id)).toEqual(newestFirst.slice(30));
    expect([first.total, second.total, second.next]).toEqual([32, 32, null]);
    expect(first.rows[0]).toMatchObject({
      title: "Thread 31",
      context: { move: "resume", reason: "cache-warm", cacheWarm: true, contextTokens: 34_000 },
      answered: false,
      lastMovedAt: threads.at(-1)?.startedAt.toISOString(),
    });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("pages the Threads on Tasks with each Task's title and Project, building no Brief", async () => {
    const roleKey = aPerson("Jan", false);
    app.get(WorkRecords).provide({
      ...NO_WORK_RECORDS,
      taskSubjects: taskSubjectsAs("Fix the login", "admin-panel"),
    });
    const threads = await threadsOf(roleKey, onATask, 31);
    const spies = spyOnBriefsAndLogs();

    const page = taskThreadPageSchema.parse(
      await (await get(`/roles/${roleKey}/task-threads`)).json(),
    );

    const newest = threads.at(-1);
    expect(page.rows).toHaveLength(30);
    expect([page.total, page.next === null]).toEqual([31, false]);
    expect(page.rows[0]).toMatchObject({
      id: newest?.id,
      task: { title: "Fix the login", projectId: "admin-panel" },
      context: { move: "resume", reason: "cache-warm", cacheWarm: true },
      answered: null,
    });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("reads a page with as many queries however many Threads the person has", async () => {
    const roleKey = aPerson("Jan", true);
    app.get(WorkRecords).provide({
      ...NO_WORK_RECORDS,
      taskSubjects: taskSubjectsAs("Fix the login", "admin-panel"),
    });
    const lists = [`/chats/${roleKey}/threads`, `/roles/${roleKey}/task-threads`];
    const readBoth = () => Promise.all(lists.map(async (path) => (await get(path)).json()));
    await threadsOf(roleKey, () => ({ kind: "chat", roleKey }), 3);
    await threadsOf(roleKey, onATask, 3);
    const few = await queriesWhile(readBoth);

    await threadsOf(roleKey, () => ({ kind: "chat", roleKey }), 60);
    await threadsOf(roleKey, onATask, 60);
    const many = await queriesWhile(readBoth);

    expect(few).toBeGreaterThan(0);
    expect(many).toBe(few);
  });

  it("refuses a cursor no page gave", async () => {
    const roleKey = aPerson("Jan", true);

    expect((await get(`/chats/${roleKey}/threads?after=not-a-cursor`)).status).toBe(400);
  });
});

/** `count` Stage Threads on the Task, by turns of each of `roleKeys`, with sessions. */
async function stageThreadsOn(
  taskId: string,
  roleKeys: readonly string[],
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const roleKey = roleKeys[index % roleKeys.length]!;
    await app.get(ThreadRepository).add(
      aThread({
        id: randomUUID(),
        home: { kind: "task", taskId },
        roleKey,
        stageThread: true,
        session: {
          id: randomUUID(),
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
      }),
    );
  }
}

describe("a Task's Threads", () => {
  it("reads the Task's setup and what its Briefs share once, however many Threads are on it", async () => {
    const taskId = randomUUID();
    const roleKeys = [aPerson("Ann", false), aPerson("Ben", false)];
    const setUps = vi.spyOn(app.get(TaskThreadSetups), "of");
    const readList = async () =>
      threadListSchema.parse(await (await get(`/tasks/${taskId}/threads`)).json());
    await stageThreadsOn(taskId, roleKeys, 2);
    const few = await queriesWhile(readList);
    const setUpsForFew = setUps.mock.calls.length;
    setUps.mockClear();

    await stageThreadsOn(taskId, roleKeys, 10);
    const many = await queriesWhile(readList);
    const setUpsForMany = setUps.mock.calls.length;

    expect(await readList()).toHaveLength(12);
    expect(few).toBeGreaterThan(0);
    expect(many).toBe(few);
    // Once for each person, as a Thread asks Work for its setup as theirs.
    expect([setUpsForFew, setUpsForMany]).toEqual([2, 2]);
  });
});

const SCREENSHOT_ID = randomUUID();

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
      {
        kind: "user",
        text: "Read the deploy workflow.",
        delivery: "delivered",
        writtenBy: ANN_LEE,
      },
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
        writtenBy: ANN_LEE,
        handoverNoteFrom: roleKey,
        openPage: { kind: "person", roleKey: devops },
        images: [{ attachmentId: SCREENSHOT_ID, name: "cache.png", mediaType: "image/png" }],
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
        writtenBy: ANN_LEE,
        handoverNoteFrom: null,
        openPage: null,
        images: [],
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
        writtenBy: ANN_LEE,
        handoverNoteFrom: roleKey,
        openPage: { kind: "person", roleKey: devops },
        images: [{ attachmentId: SCREENSHOT_ID, name: "cache.png", mediaType: "image/png" }],
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
    people.set(
      roleKey,
      sessionRole(
        roleKey,
        2,
        aPlannerCard({
          capabilities: {
            sharedMemory: false,
            chat: false,
            consultant: true,
            runEnvironment: false,
          },
        }),
        MCP_TOOL_DEFAULT_STAND_IN,
      ),
    );
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

/**
 * Uploads `size` bytes starting with `signature` as the image `fileName`, as the message box does.
 */
function paste(
  threadId: string,
  {
    fileName = "screen.png",
    size = 16,
    signature = PNG_SIGNATURE as readonly number[] | Uint8Array,
  } = {},
): Promise<Response> {
  const query = new URLSearchParams({ fileName });
  const body = new Uint8Array(Math.max(size, signature.length)).fill(1);
  body.set(signature);
  return fetch(`${url}/api/threads/${threadId}/images?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
}

async function aThreadAt(home: Thread["home"]): Promise<Thread> {
  const thread = aThread({ id: randomUUID(), home, roleKey: aPerson("Jan", true) });
  await app.get(ThreadRepository).add(thread);
  return thread;
}

describe("an image pasted into a Thread", () => {
  it("is kept on the Thread's Task or Initiative, and on a chat's Thread itself", async () => {
    const taskId = randomUUID();
    const initiativeId = randomUUID();
    const onTask = await aThreadAt({ kind: "task", taskId });
    const onInitiative = await aThreadAt({ kind: "initiative", initiativeId });
    const chat = await aThreadAt({ kind: "chat", roleKey: "planner" });

    const kept = await Promise.all(
      [onTask, onInitiative, chat].map(async ({ id }) =>
        messageImageSchema.parse(await (await paste(id)).json()),
      ),
    );

    expect(kept.map(({ name, mediaType }) => ({ name, mediaType }))).toEqual([
      { name: "screen.png", mediaType: "image/png" },
      { name: "screen.png", mediaType: "image/png" },
      { name: "screen.png", mediaType: "image/png" },
    ]);
    expect(kept.map(({ attachmentId }) => messageImages.kept.get(attachmentId)?.owner)).toEqual([
      { kind: "task", taskId },
      { kind: "initiative", initiativeId },
      { kind: "thread", threadId: chat.id },
    ]);
  });

  it("is refused in words when it isn't a picture a message carries, or is too large", async () => {
    const chat = await aThreadAt({ kind: "chat", roleKey: "planner" });

    const drawing = await paste(chat.id, {
      fileName: "logo.svg",
      signature: SVG,
    });
    const named = await paste(chat.id, { fileName: "notes.png", signature: [0x6e, 0x6f] });
    const large = await paste(chat.id, { size: MESSAGE_IMAGE_BYTES + 1 });
    const nowhere = await paste(randomUUID());

    expect(drawing.status).toBe(422);
    expect(threadRefusalSchema.parse(await drawing.json()).reasons).toEqual([
      "logo.svg isn't an image the message can carry: only PNG, JPEG, GIF and WebP are.",
    ]);
    expect(named.status).toBe(422);
    expect(threadRefusalSchema.parse(await named.json()).reasons).toEqual([
      "notes.png isn't an image the message can carry: only PNG, JPEG, GIF and WebP are.",
    ]);
    expect(large.status).toBe(422);
    expect(threadRefusalSchema.parse(await large.json()).reasons).toEqual([
      "screen.png is larger than 3 MB, the most one image may be.",
    ]);
    expect(nowhere.status).toBe(404);
    expect(messageImages.kept.size).toBe(0);
  });

  it("is kept as the type its bytes are, whatever the browser named", async () => {
    const chat = await aThreadAt({ kind: "chat", roleKey: "planner" });

    const response = await paste(chat.id, { signature: JPEG_SIGNATURE });

    expect(messageImageSchema.parse(await response.json()).mediaType).toBe("image/jpeg");
  });

  it("goes only with a message to the Thread it was pasted into", async () => {
    const roleKey = aPerson("Jan", true);
    const chat = threadSchema.parse(await (await send("POST", `/chats/${roleKey}/threads`)).json());
    const other = await aThreadAt({ kind: "chat", roleKey: "planner" });
    const { attachmentId } = messageImageSchema.parse(await (await paste(other.id)).json());

    const refused = await send("POST", `/threads/${chat.id}/messages`, {
      text: "Look.",
      images: [attachmentId],
    });

    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "An image the message carries isn't one sent to this Thread: paste it again.",
    ]);
    expect(await (await get(`/threads/${chat.id}/messages`)).json()).toEqual([]);
  });
});

describe("a Decision", () => {
  const question = {
    kind: "choice",
    question: "Should the export include archived Projects?",
    options: ["Only active Projects", "Every Project"],
    recommendation: { option: 0, reason: "Archived ones have nothing to export." },
  } as const;
  const draft: DecisionDraft = {
    context: "Archived Projects have no worktree.",
    questions: [question],
  };

  /** A planning Thread on a Task, of its own unless `taskId` names one, whose session opened a Decision. */
  async function opened(
    taskId: string = randomUUID(),
    stageThread = false,
  ): Promise<{ readonly thread: Thread; readonly decision: Decision }> {
    const roleKey = aPerson("Jan", false);
    const sessionId = randomUUID();
    const thread = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId },
      roleKey,
      title: "Planning",
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
    const { decision } = await app.get(DecisionService).open(sessionId, draft);
    return { thread, decision };
  }

  it("shows in the Thread's log as its card, and among the open Decisions, as the web reads them", async () => {
    const { thread, decision } = await opened();

    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    const shown = {
      kind: "form",
      context: draft.context,
      questions: [question],
      id: decision.id,
      threadId: thread.id,
      inStageThread: false,
      taskId: decision.taskId,
      roleKey: thread.roleKey,
      attachmentIds: [],
      askedAt: decision.askedAt.toISOString(),
      putTo: null,
      passedOn: [],
      formAnswer: null,
      answeredAt: null,
      answeredByUser: null,
      answeredBy: null,
      atUsersRequest: null,
      fields: null,
      answeredByTheOffice: false,
      closedAt: null,
      closedBecause: null,
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

  it("reads a Task's conversation with as many queries however many Consultations are on it", async () => {
    const taskId = randomUUID();
    const consultant = aPerson("Ben", false);
    const consulted = async (count: number): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        const { thread, decision } = await opened(taskId);
        await app.get(ThreadRepository).add(
          aThread({
            id: randomUUID(),
            home: { kind: "task", taskId },
            roleKey: consultant,
            consultation: {
              decisionId: decision.id,
              askerThreadId: thread.id,
              askerRoleKey: thread.roleKey,
            },
          }),
        );
      }
    };
    const readTabs = async () => {
      const response = await get(`/tasks/${taskId}/conversation`);
      expect(response.status).toBe(200);
      return response.json();
    };
    await consulted(1);
    const few = await queriesWhile(readTabs);

    await consulted(6);
    const many = await queriesWhile(readTabs);

    expect(few).toBeGreaterThan(0);
    expect(many).toBe(few);
  });

  it("refuses a second answer, and shows the first in the log", async () => {
    const { thread, decision } = await opened();
    const answered: Decision = {
      ...decision,
      answer: { ...oneWordsAnswer("Only this year's."), answeredAt: new Date() },
    };
    await app.get(ThreadRepository).update(thread.id, (current) => {
      const waiting = { ...current, openDecisions: [] };
      const line = {
        kind: "decision-answer",
        id: randomUUID(),
        threadId: thread.id,
        at: new Date(),
        decisionId: decision.id,
        answer: oneWordsAnswer("Only this year's."),
      } as const;
      return {
        thread: waiting,
        logged: [line],
        decision: answered,
        event: new DecisionAnswered(waiting, answered, new Date()),
      };
    });

    const again = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "submitted",
      answers: [{ kind: "option", option: 0 }],
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
      formAnswer: oneWordsAnswer("Only this year's."),
      decision: { formAnswer: oneWordsAnswer("Only this year's.") },
    });
    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    expect(open.map(({ id }) => id)).not.toContain(decision.id);
  });

  it("is dismissed with a general comment, closing it, its answer shown in the log", async () => {
    const { thread, decision } = await opened();

    const dismissed = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "dismissed",
      generalComment: "We dropped the export.",
    });
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    expect(dismissed.status).toBe(202);
    const formAnswer = { kind: "dismissed", generalComment: "We dropped the export." };
    expect(messages.map((message) => message.kind)).toEqual(["decision", "decision-answer"]);
    expect(messages[1]).toMatchObject({
      formAnswer,
      decision: { formAnswer, inStageThread: false, answeredByUser: expect.anything() },
    });
    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    expect(open.map(({ id }) => id)).not.toContain(decision.id);
  });

  it("refuses a dismissal of one in a Stage Thread, and says it is in one", async () => {
    const { decision } = await opened(randomUUID(), true);

    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    const refused = await send("POST", `/decisions/${decision.id}/answer`, { kind: "dismissed" });

    expect(open.find(({ id }) => id === decision.id)?.inStageThread).toBe(true);
    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "A Decision in a Stage Thread can't be dismissed: its Stage waits on the answer.",
    ]);
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
      // As the web sends it: the Hard switches beside the Authority.
      card: {
        ...aProposedCard(),
        hardSwitches: hardSwitchesOf("tester", aProposedCard().authority),
        name: "Tom",
        skills: [],
      },
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

describe("what each signed-in user does", () => {
  const BY_BEN = signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS);

  it("lets another user answer a Decision opened while the first wrote in its Thread, naming each", async () => {
    // In a Stage Thread the answer is only recorded, for the Pipeline: no session takes it.
    const taskId = randomUUID();
    const { thread, sessionId } = await withSession(() => ({ kind: "task", taskId }), {
      stageThread: true,
    });
    await app
      .get(ThreadService)
      .log(thread.id, [
        { kind: "user", text: "Export every column.", delivery: "delivered", writtenBy: ANN_LEE },
      ]);
    const { decision } = await app.get(DecisionService).open(sessionId, {
      context: "The export is wide.",
      questions: [
        {
          kind: "choice",
          question: "Which columns?",
          options: ["All", "Visible"],
          recommendation: { option: 1, reason: "Fewer to read." },
        },
      ],
    });

    const answering = await send(
      "POST",
      `/decisions/${decision.id}/answer`,
      { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
      BY_BEN,
    );
    const log = messageListSchema.parse(await (await get(`/threads/${thread.id}/messages`)).json());

    expect(answering.status).toBe(202);
    expect(log.map((message) => message.kind)).toEqual(["user", "decision", "decision-answer"]);
    expect(log[0]).toMatchObject({ kind: "user", writtenBy: ANN_LEE });
    expect(log[2]).toMatchObject({
      kind: "decision-answer",
      decision: {
        formAnswer: { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
        answeredByUser: BEN_ITO,
      },
    });
    expect((await app.get(ThreadRepository).decision(decision.id))?.answer?.user).toEqual(BEN_ITO);
  });

  it("names the user who applied a Proposal, the one who declined one, and who saved the Office instructions", async () => {
    const toApply = await drafted();
    const { sessionId } = await withSession((roleKey) => ({ kind: "chat", roleKey }));
    const toDecline = await app.get(ProposalService).draft(sessionId, {
      kind: "hire",
      card: aProposedCard(),
      skills: [],
      roleKey: undefined,
    });

    const applied = await send("POST", `/proposals/${toApply.proposalId}/apply`, {}, BY_BEN);
    const declined = await send("POST", `/proposals/${toDecline.id}/decline`);
    const saved = await send(
      "PUT",
      "/settings/office-instructions",
      { officeInstructions: "Answer in plain words." },
      BY_BEN,
    );

    expect(proposalSchema.parse(await applied.json()).status).toEqual({
      kind: "applied",
      at: expect.any(String),
      by: BEN_ITO,
    });
    expect(proposalSchema.parse(await declined.json()).status).toEqual({
      kind: "declined",
      at: expect.any(String),
      by: ANN_LEE,
      because: null,
    });
    expect(saved.status).toBe(200);
    const { version } = await app.get(OfficeInstructions).current();
    const versions = app.get(OfficeInstructionsRepository) as OfficeInstructionsRepositoryForTests;
    expect(versions.savedBy.get(version)).toEqual(BEN_ITO);
  });
});

describe("Allow changes", () => {
  it("is switched on and off in the Caretaker's chat, with a line each time, and refused elsewhere", async () => {
    people.set(
      CARETAKER,
      sessionRole(
        CARETAKER,
        1,
        aPlannerCard({ name: "Sam", title: "Caretaker" }),
        MCP_TOOL_DEFAULT_STAND_IN,
      ),
    );
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
    expect(
      log.map((message) => message.kind === "changes-allowed" && [message.allowed, message.by]),
    ).toEqual([
      [true, ANN_LEE],
      [false, ANN_LEE],
    ]);
    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Only the Caretaker's chat has Allow changes.",
    ]);
    expect((await send("PUT", `/threads/${randomUUID()}/allow-changes`)).status).toBe(404);
  });
});
