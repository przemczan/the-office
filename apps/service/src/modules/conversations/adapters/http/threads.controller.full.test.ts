import { randomInt, randomUUID } from "node:crypto";
import {
  chatActivitySchema,
  decisionListSchema,
  fireAlarmLiftsSchema,
  messageListSchema,
  OFFICE_INSTRUCTIONS_MAX_CHARACTERS,
  officeInstructionsSchema,
  peopleWorkingSchema,
  proposalSchema,
  sizeThresholdSchema,
  firstBriefSchema,
  taskConversationSchema,
  threadListSchema,
  threadRefusalSchema,
  threadSchema,
  threadWebEventSchema,
} from "@the-office/contracts";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { DecisionService } from "../../application/decision-service.js";
import { ThreadService } from "../../application/thread-service.js";
import { ThreadRenamed } from "../../domain/conversation-events.js";
import type { Decision } from "../../domain/decision.js";
import { aDecision } from "../../domain/decision.fixtures.js";
import type { Thread } from "../../domain/thread.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";
import { OfficeInstructions } from "../../application/office-instructions.js";
import { FireAlarmInThreads } from "../../application/fire-alarm-in-threads.js";
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
import { EngineCascade, RoleCards, type SessionRole } from "../../../people/index.js";
import { EngineCascadeStandIn } from "../../../people/index.fixtures.js";
import { McpServersModule } from "../../../mcp-servers/index.js";
import { SkillsModule } from "../../../skills/index.js";
import { Briefs } from "../../application/briefs.js";
import { sessionMemoryProvider } from "../../application/session-memory.fixtures.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import { LinkCards } from "../../application/link-cards.js";
import { ProposalService } from "../../application/proposal-service.js";
import { aPlannerCard } from "../../application/session-role.fixtures.js";
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
import { aProposedCard } from "../../domain/proposal.fixtures.js";
import { ProjectBases } from "../../ports/project-bases.js";
import { noProjectBases } from "../../ports/project-bases.fixtures.js";
import { PostgresThreadRepository } from "../postgres/postgres-thread-repository.js";
import { ThreadWebEvents } from "../websocket/thread-web-events.js";
import { DecisionsController } from "./decisions.controller.js";
import { FireAlarmLiftsController } from "./fire-alarm-lifts.controller.js";
import { ProposalsController } from "./proposals.controller.js";
import { OfficeInstructionsController } from "./office-instructions.controller.js";
import { SizeThresholdController } from "./size-threshold.controller.js";
import { ThreadsController } from "./threads.controller.js";
import { ConversationsSettings } from "../../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../../ports/office-instructions-repository.js";
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
import { SubAgentAndProcessRepository } from "../../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../postgres/postgres-sub-agent-and-process-repository.js";

// What threads.controller.test.ts and threads.controller.full.test.ts share.

const outputMasks = new ProjectOutputMasksForTests();
/** The Initiative's planning Thread each Task is planned in, by the Task's id. */
const plannedElsewhere = new Map<string, { initiativeId: string; threadId: string }>();

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
    const bases = noProjectBases(join(officeData, "bases"));
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
        {
          provide: SubAgentAndProcessRepository,
          useClass: PostgresSubAgentAndProcessRepository,
        },
        SubAgentsAndProcesses,
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
      planningThreadElsewhere: (taskId) => Promise.resolve(plannedElsewhere.get(taskId)),
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

describe("a Task's conversation", () => {
  it("lists the Threads on the Task, the newest first, and none on another", async () => {
    const taskId = randomUUID();
    const repository = app.get(ThreadRepository);
    const home = { kind: "task", taskId } as const;
    const older = aThread({
      id: randomUUID(),
      home,
      startedAt: new Date("2026-10-25T09:00:00.000Z"),
    });
    const newer = aThread({
      id: randomUUID(),
      home,
      startedAt: new Date("2026-10-25T10:00:00.000Z"),
    });
    await repository.add(older);
    await repository.add(newer);

    const listed = await get(`/tasks/${taskId}/threads`);
    const elsewhere = await get(`/tasks/${randomUUID()}/threads`);

    expect(threadListSchema.parse(await listed.json()).map(({ id }) => id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(threadListSchema.parse(await elsewhere.json())).toEqual([]);
  });

  it("has a tab for the Planner, each person of a Stage and each Consultant who answered", async () => {
    const taskId = randomUUID();
    const home = { kind: "task", taskId } as const;
    const repository = app.get(ThreadRepository);
    const oscar = aPerson("Oscar", false);
    const stageThread = aThread({ id: randomUUID(), home, roleKey: oscar, stageThread: true });
    await repository.add({ ...stageThread, state: "answering" });

    const tabs = await get(`/tasks/${taskId}/conversation`);

    expect(taskConversationSchema.parse(await tabs.json()).tabs).toEqual([
      {
        roleKey: "planner",
        threadId: null,
        stageRunning: false,
        consultations: [],
        planningThreadElsewhere: null,
      },
      {
        roleKey: oscar,
        threadId: null,
        stageRunning: true,
        consultations: [],
        planningThreadElsewhere: null,
      },
    ]);
  });

  it("says who is working on each Task, leaving out a Stage waiting on its Decision", async () => {
    const [working, waiting, idle] = [randomUUID(), randomUUID(), randomUUID()];
    const repository = app.get(ThreadRepository);
    const answering = (taskId: string, fields: Partial<Thread>): Promise<void> =>
      repository.add(
        aThread({
          id: randomUUID(),
          home: { kind: "task", taskId },
          state: "answering",
          ...fields,
        }),
      );
    const oscar = aPerson("Oscar", false);
    await answering(working, { roleKey: oscar, stageThread: true });
    await answering(working, { roleKey: oscar });
    const stageThread = randomUUID();
    await answering(waiting, { id: stageThread, roleKey: oscar, stageThread: true });
    await repository.update(stageThread, (current) => ({
      thread: current,
      logged: [],
      decision: aDecision({ threadId: stageThread, taskId: waiting, roleKey: oscar }),
      event: new ThreadRenamed(current, new Date()),
    }));
    await repository.add(aThread({ id: randomUUID(), home: { kind: "task", taskId: idle } }));

    const read = await get("/people-working");

    const tasks = peopleWorkingSchema.parse(await read.json());
    const tasksOfThisTest = new Set<string>([working, waiting, idle]);
    const onThisTest = tasks.filter(({ taskId }) => tasksOfThisTest.has(taskId));
    expect(onThisTest).toEqual([{ taskId: working, roleKeys: [oscar] }]);
  });

  it("opens a person's one Thread on the Task, briefed as a new session and never a Stage's", async () => {
    const taskId = randomUUID();
    const home = { kind: "task", taskId } as const;
    const oscar = aPerson("Oscar", false);
    await app
      .get(ThreadRepository)
      .add(aThread({ id: randomUUID(), home, roleKey: oscar, stageThread: true }));
    const path = `/tasks/${taskId}/conversation/${oscar}/thread`;

    const [opened, again] = await Promise.all([send("POST", path), send("POST", path)]);

    expect(opened.status).toBe(201);
    const thread = threadSchema.parse(await opened.json());
    expect(thread).toMatchObject({
      roleKey: oscar,
      stageThread: false,
      consultation: null,
      title: "Asking Oscar",
      context: { move: "fresh", reason: "new-thread", cacheWarm: false, cacheWarmUntil: null },
    });
    expect(threadSchema.parse(await again.json()).id).toBe(thread.id);
    const tabs = await get(`/tasks/${taskId}/conversation`);
    expect(taskConversationSchema.parse(await tabs.json()).tabs[1]?.threadId).toBe(thread.id);
  });

  it("points the Planner's tab to the Initiative's planning Thread a Task is planned in, and opens no Thread of the Planner's on it", async () => {
    const taskId = randomUUID();
    const elsewhere = { initiativeId: randomUUID(), threadId: randomUUID() };
    plannedElsewhere.set(taskId, elsewhere);

    const tabs = taskConversationSchema.parse(
      await (await get(`/tasks/${taskId}/conversation`)).json(),
    ).tabs;
    const opened = await send("POST", `/tasks/${taskId}/conversation/planner/thread`);

    expect(tabs[0]).toMatchObject({ roleKey: "planner", planningThreadElsewhere: elsewhere });
    expect(opened.status).toBeGreaterThanOrEqual(400);
    expect(await opened.json()).toMatchObject({
      reasons: ["This Task is being planned in its Initiative's planning Thread: carry on there."],
    });
    plannedElsewhere.delete(taskId);
  });

  it("says when a Thread's warm cache goes cold, for the To line to count down", async () => {
    const { thread } = await withSession(() => ({ kind: "task", taskId: randomUUID() }));

    const read = threadSchema.parse(await (await get(`/threads/${thread.id}`)).json());

    expect(read.context.cacheWarm).toBe(true);
    expect(Date.parse(read.context.cacheWarmUntil ?? "")).toBeGreaterThan(Date.now());
  });

  it("says what a tab's first message would start on, opening nothing", async () => {
    const taskId = randomUUID();
    const home = { kind: "task", taskId } as const;
    const repository = app.get(ThreadRepository);
    const oscar = aPerson("Oscar", false);
    await repository.add(aThread({ id: randomUUID(), home, roleKey: oscar, stageThread: true }));

    const read = await get(`/tasks/${taskId}/conversation/${oscar}/brief`);

    expect(firstBriefSchema.parse(await read.json()).tokens).toBeGreaterThan(0);
    expect(await repository.listIn(home)).toHaveLength(1);
  });

  it("gives no Brief for someone with no tab on the Task", async () => {
    const read = await get(`/tasks/${randomUUID()}/conversation/${aPerson("Oscar", false)}/brief`);

    expect(read.status).toBe(422);
  });

  it("refuses a Thread for someone with no tab on the Task", async () => {
    const opened = await send(
      "POST",
      `/tasks/${randomUUID()}/conversation/${aPerson("Oscar", false)}/thread`,
    );

    expect(opened.status).toBe(422);
  });

  it("lists a person's Threads on every Task, for their Work tab", async () => {
    const roleKey = aPerson("Jan", false);
    const repository = app.get(ThreadRepository);
    const planning = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId: randomUUID() },
      roleKey,
      title: "Planning",
    });
    await repository.add(planning);
    await repository.add(aThread({ id: randomUUID(), home: { kind: "chat", roleKey }, roleKey }));

    const listed = await get(`/roles/${roleKey}/task-threads`);

    expect(listed.status).toBe(200);
    expect(threadListSchema.parse(await listed.json())).toEqual([
      expect.objectContaining({ id: planning.id, home: planning.home, title: "Planning" }),
    ]);
  });
});

describe("a Thread", () => {
  it("is renamed, and a title it refuses names the reason", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    const renamed = await send("PUT", `/threads/${thread.id}/title`, { title: "  Deploys " });
    const refused = await send("PUT", `/threads/${thread.id}/title`, { title: "" });

    expect(threadSchema.parse(await renamed.json()).title).toBe("Deploys");
    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Give the Thread a title.",
    ]);
    expect(webEvents()).toContainEqual({
      type: "thread.renamed",
      threadId: thread.id,
      home: { kind: "chat", roleKey },
    });
  });

  it("takes Start fresh or Continue anyway for the next message, and back to the policy", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    const chosen = await send("PUT", `/threads/${thread.id}/context-override`, {
      override: "start-fresh",
    });
    const cleared = await send("PUT", `/threads/${thread.id}/context-override`, { override: null });

    expect(threadSchema.parse(await chosen.json()).context.override).toBe("start-fresh");
    expect(threadSchema.parse(await cleared.json()).context.override).toBeNull();
    expect(webEvents()).toContainEqual({
      type: "thread.override-chosen",
      threadId: thread.id,
      home: { kind: "chat", roleKey },
    });
  });

  it("keeps the Open page a message was sent with, and refuses one that isn't a page", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );
    const openPage = { kind: "project", projectId: "admin-panel" } as const;

    const sent = await send("POST", `/threads/${thread.id}/messages`, {
      text: "Where does it publish?",
      openPage,
    });
    const notAPage = await send("POST", `/threads/${thread.id}/messages`, {
      text: "Hello.",
      openPage: { kind: "task", taskId: "not-an-id" },
    });

    expect(sent.status).toBe(202);
    expect(notAPage.status).toBe(400);
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );
    expect(messages.find(({ kind }) => kind === "user")).toMatchObject({
      text: "Where does it publish?",
      openPage,
    });
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
    const { decision } = await app.get(DecisionService).open(sessionId, draft);
    return { thread, decision };
  }

  it("refuses an answer that isn't one of its options, or isn't an answer, and is not found when it isn't there", async () => {
    const { decision } = await opened();

    const wrongOption = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "option",
      option: 2,
    });
    const noAnswer = await send("POST", `/decisions/${decision.id}/answer`, { kind: "maybe" });
    const nowhere = await send("POST", `/decisions/${randomUUID()}/answer`, {
      kind: "free-answer",
      text: "Yes.",
    });

    expect(wrongOption.status).toBe(422);
    expect(threadRefusalSchema.parse(await wrongOption.json()).reasons).toEqual([
      "Choose one of the Decision's options.",
    ]);
    expect(noAnswer.status).toBe(400);
    expect(nowhere.status).toBe(404);
  });

  it("opens again when the session its answer goes to fails to start, keeping the answer in the log", async () => {
    // The scripted engine has no script: resuming the Decision's session fails.
    const { thread, decision } = await opened();

    const response = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "free-answer",
      text: "Only this year's.",
    });
    const open = await vi.waitFor(
      async () => {
        const decisions = decisionListSchema.parse(await (await get("/decisions/open")).json());
        if (!decisions.some(({ id }) => id === decision.id)) throw new Error("Still answered.");
        return decisions;
      },
      { timeout: 5_000, interval: 20 },
    );
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    expect(response.status).toBe(202);
    expect(open.find(({ id }) => id === decision.id)).toMatchObject({ answer: null });
    expect(messages.map((message) => message.kind)).toEqual([
      "decision",
      "decision-answer",
      "failure",
    ]);
    expect(messages[1]).toMatchObject({
      answer: { kind: "free-answer", text: "Only this year's." },
      decision: { answer: null },
    });
    expect(webEvents()).toContainEqual({
      type: "thread.decision-reopened",
      threadId: thread.id,
      home: thread.home,
      decisionId: decision.id,
    });
  });

  it("lists a Task's unanswered Decisions, those with a Consultant too, the first asked first", async () => {
    const { decision } = await opened();
    const taskId = decision.taskId;
    // In a Stage Thread the answer is only recorded. Anywhere else it goes to a session, and with
    // no script that fails in the background, opening the Decision again under the last read.
    const inAnotherThread = await withSession(() => ({ kind: "task", taskId }), {
      stageThread: true,
    });
    const { decision: withConsultant } = await app
      .get(DecisionService)
      .open(inAnotherThread.sessionId, draft, { putTo: "devops" });
    const { decision: onAnotherTask } = await opened();

    const unanswered = decisionListSchema.parse(
      await (await get(`/tasks/${taskId}/decisions/unanswered`)).json(),
    );
    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());

    expect(unanswered.map(({ id, putTo }) => [id, putTo])).toEqual([
      [decision.id, null],
      [withConsultant.id, "devops"],
    ]);
    expect(open.map(({ id }) => id)).not.toContain(withConsultant.id);
    expect(unanswered.map(({ id }) => id)).not.toContain(onAnotherTask.id);

    await app.get(DecisionService).answer(withConsultant.id, { kind: "option", option: 0 });

    const left = decisionListSchema.parse(
      await (await get(`/tasks/${taskId}/decisions/unanswered`)).json(),
    );
    expect(left.map(({ id }) => id)).toEqual([decision.id]);
  });
});

describe("a Proposal", () => {
  it("declines, and refuses a change once declined", async () => {
    const { thread, proposalId } = await drafted();

    const declining = await send("POST", `/proposals/${proposalId}/decline`);
    const applying = await send("POST", `/proposals/${proposalId}/apply`, {});

    expect(proposalSchema.parse(await declining.json()).status).toMatchObject({ kind: "declined" });
    expect(applying.status).toBe(422);
    expect(threadRefusalSchema.parse(await applying.json()).reasons).toEqual([
      "This Proposal was declined.",
    ]);
    expect(webEvents()).toContainEqual({
      type: "thread.proposal-declined",
      threadId: thread.id,
      home: thread.home,
      proposalId,
    });
    expect((await get(`/proposals/${randomUUID()}`)).status).toBe(404);
  });
});

describe("an Idea's card and the Office status", () => {
  it("show in the chat's log as their cards, as the web reads them", async () => {
    const { thread, sessionId } = await withSession((roleKey) => ({ kind: "chat", roleKey }));
    const ideaId = randomUUID();

    await app.get(ThreadService).postIdeaCard(sessionId, ideaId);
    await app.get(ThreadService).postOfficeStatus(sessionId);
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    expect(messages.map(({ id: _id, at: _at, ...message }) => message)).toEqual([
      { kind: "idea", roleKey: thread.roleKey, ideaId },
      { kind: "office-status", roleKey: thread.roleKey },
    ]);
  });

  it("are left out of a Thread on a Task, and of a session no Thread has", async () => {
    const { thread, sessionId } = await withSession(() => ({
      kind: "task",
      taskId: randomUUID(),
    }));

    await app.get(ThreadService).postIdeaCard(sessionId, randomUUID());
    await app.get(ThreadService).postOfficeStatus(randomUUID());

    expect(await app.get(ThreadService).messages(thread.id)).toEqual([]);
  });
});

describe("/api/settings/size-threshold", () => {
  it("keeps a new size threshold for the next continuation and announces it", async () => {
    const changed = await send("PUT", "/settings/size-threshold", { sizeThreshold: 50_000 });

    expect(changed.status).toBe(200);
    expect(sizeThresholdSchema.parse(await (await get("/settings/size-threshold")).json())).toEqual(
      { sizeThreshold: 50_000 },
    );
    await expect(app.get(ContextPolicySettingsService).current()).resolves.toMatchObject({
      sizeThreshold: 50_000,
    });
    expect(webEvents()).toEqual([{ type: "context-policy.size-threshold-changed" }]);
  });

  it.each([0, 12_345, 1_000_000])("refuses %s tokens", async (sizeThreshold) => {
    const refused = await send("PUT", "/settings/size-threshold", { sizeThreshold });

    expect(refused.status).toBe(400);
    expect(published).toEqual([]);
  });
});

describe("/api/settings/office-instructions", () => {
  const path = "/settings/office-instructions";

  async function saved(): Promise<string> {
    return officeInstructionsSchema.parse(await (await get(path)).json()).officeInstructions;
  }

  async function save(officeInstructions: string): Promise<Response> {
    return send("PUT", path, { officeInstructions });
  }

  it("reads empty until a text is saved", async () => {
    expect(await saved()).toBe("");
  });

  it("keeps a saved text as a new version and announces it", async () => {
    const changed = await save("Write in plain words.");

    expect(changed.status).toBe(200);
    expect(officeInstructionsSchema.parse(await changed.json())).toEqual({
      officeInstructions: "Write in plain words.",
    });
    expect(await saved()).toBe("Write in plain words.");
    await expect(app.get(OfficeInstructions).current()).resolves.toEqual({
      version: 1,
      text: "Write in plain words.",
    });
    expect(webEvents()).toEqual([{ type: "office-instructions.changed" }]);
  });

  it("makes no new version and announces nothing for the same text", async () => {
    await save("Write in plain words.");
    published.length = 0;

    const again = await save("  Write in plain words.\n");

    expect(again.status).toBe(200);
    await expect(app.get(OfficeInstructions).current()).resolves.toMatchObject({ version: 1 });
    expect(published).toEqual([]);
  });

  it("trims the ends of a text and keeps its own lines", async () => {
    await save("\n  First line.\n\n  Second line.  \n");

    expect(await saved()).toBe("First line.\n\n  Second line.");
  });

  it("saves a blank text as empty", async () => {
    await save("Write in plain words.");

    await save(" \n\t ");

    expect(await saved()).toBe("");
    await expect(app.get(OfficeInstructions).current()).resolves.toEqual({ version: 2, text: "" });
  });

  it("takes a text at the limit, counted without the spaces around it", async () => {
    const atTheLimit = await save(` ${"x".repeat(OFFICE_INSTRUCTIONS_MAX_CHARACTERS)} `);

    expect(atTheLimit.status).toBe(200);
  });

  it("refuses a text over the limit", async () => {
    const refused = await save("x".repeat(OFFICE_INSTRUCTIONS_MAX_CHARACTERS + 1));

    expect(refused.status).toBe(400);
    expect(await saved()).toBe("");
    expect(published).toEqual([]);
  });
});

async function liftsAfter(response: Promise<Response>): Promise<readonly string[]> {
  return fireAlarmLiftsSchema.parse(await (await response).json()).threadIds;
}

describe("the fire alarm's lifts", () => {
  it("lets a Thread's Agent act while the alarm is on, until taken back, and none while it is off", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );
    const refused = await send("PUT", `/fire-alarm/lifts/${thread.id}`);
    // A sounding of the test's own: lifts are kept by it, in a table every test file shares.
    const since = new Date(Date.UTC(2026, 9, 29) + randomInt(2 ** 40));
    app.get(FireAlarmInThreads).readFrom(() => Promise.resolve({ on: true, since }));

    const lifted = await liftsAfter(send("PUT", `/fire-alarm/lifts/${thread.id}`));
    const listed = await liftsAfter(get("/fire-alarm/lifts"));
    const takenBack = await liftsAfter(send("DELETE", `/fire-alarm/lifts/${thread.id}`));
    const nobody = await send("PUT", `/fire-alarm/lifts/${randomUUID()}`);

    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "The fire alarm isn't on: every Agent may act already.",
    ]);
    expect([lifted, listed, takenBack]).toEqual([[thread.id], [thread.id], []]);
    expect(nobody.status).toBe(404);
  });
});

async function aChatThread(roleKey: string): Promise<Thread> {
  const { id } = threadSchema.parse(await (await send("POST", `/chats/${roleKey}/threads`)).json());
  return app.get(ThreadService).read(id);
}

async function answerIn(thread: Thread, text: string): Promise<string> {
  const [answer] = await app
    .get(ThreadService)
    .log(thread.id, [{ kind: "person", roleKey: thread.roleKey, text }]);
  if (!answer) throw new Error("Nothing was logged.");
  return answer.id;
}

async function reading(threadId: string): Promise<boolean | null> {
  const response = await get(`/threads/${threadId}`);
  return threadSchema.parse(await response.json()).answered;
}

async function activityOf(roleKey: string) {
  const activity = chatActivitySchema.parse(await (await get("/chats/activity")).json());
  return activity.find((person) => person.roleKey === roleKey);
}

describe("what the user has seen in a chat", () => {
  it("counts an answer as answered until its message is seen, and tells the web", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = await aChatThread(roleKey);
    expect(await reading(thread.id)).toBe(false);
    const answer = await answerIn(thread, "Done.");

    expect(await reading(thread.id)).toBe(true);
    expect((await activityOf(roleKey))?.answered.map(({ threadId }) => threadId)).toEqual([
      thread.id,
    ]);

    published.length = 0;
    const seen = await send("PUT", `/threads/${thread.id}/seen`, { messageId: answer });

    expect(threadSchema.parse(await seen.json()).answered).toBe(false);
    expect((await activityOf(roleKey))?.answered).toEqual([]);
    expect(webEvents()).toEqual([{ type: "thread.seen", threadId: thread.id, home: thread.home }]);
  });

  it("keeps a later message answered when an earlier one is marked seen", async () => {
    const thread = await aChatThread(aPerson("Jan", true));
    const first = await answerIn(thread, "First.");
    const second = await answerIn(thread, "Second.");

    await send("PUT", `/threads/${thread.id}/seen`, { messageId: first });
    expect(await reading(thread.id)).toBe(true);

    await send("PUT", `/threads/${thread.id}/seen`, { messageId: second });
    await send("PUT", `/threads/${thread.id}/seen`, { messageId: first });
    await answerIn(thread, "Third.");
    await send("PUT", `/threads/${thread.id}/seen`, { messageId: second });
    expect(await reading(thread.id)).toBe(true);
  });

  it("never moves the record back, and says nothing when it stays", async () => {
    const thread = await aChatThread(aPerson("Jan", true));
    const first = await answerIn(thread, "First.");
    const second = await answerIn(thread, "Second.");
    await send("PUT", `/threads/${thread.id}/seen`, { messageId: second });

    published.length = 0;
    await send("PUT", `/threads/${thread.id}/seen`, { messageId: first });

    expect(await reading(thread.id)).toBe(false);
    expect(webEvents()).toEqual([]);
  });

  it("leaves the user's own messages and switches out of what counts as answered", async () => {
    const thread = await aChatThread(aPerson("Jan", true));

    await app.get(ThreadService).log(thread.id, [
      { kind: "user", text: "Are you there?", delivery: "delivered" },
      { kind: "changes-allowed", allowed: true },
    ]);

    expect(await reading(thread.id)).toBe(false);
  });

  it("counts a failed turn's line, which the user should read too", async () => {
    const thread = await aChatThread(aPerson("Jan", true));

    await app
      .get(ThreadService)
      .log(thread.id, [{ kind: "failure", reason: "The engine stopped." }]);

    expect(await reading(thread.id)).toBe(true);
  });

  it("doesn't count while the person is still answering, and says they are", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = await aChatThread(roleKey);
    await answerIn(thread, "Reading the code…");
    await app.get(ThreadRepository).update(thread.id, (current) => ({
      thread: { ...current, state: "answering" },
      logged: [],
      event: new ThreadRenamed(current, new Date()),
    }));

    expect(await reading(thread.id)).toBe(false);
    expect(await activityOf(roleKey)).toMatchObject({ answering: true, answered: [] });
  });

  it("has no record for a Thread on a Task, and refuses marking one", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = await app
      .get(ThreadService)
      .openOnTask({ taskId: randomUUID(), roleKey, title: "Asking Jan" });
    const [message] = await app
      .get(ThreadService)
      .log(thread.id, [{ kind: "person", roleKey, text: "On the Task." }]);

    const refused = await send("PUT", `/threads/${thread.id}/seen`, { messageId: message?.id });

    expect(await reading(thread.id)).toBeNull();
    expect(await activityOf(roleKey)).toBeUndefined();
    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Only a chat's Threads keep what you have seen.",
    ]);
  });

  it("refuses a message from another Thread, and one that isn't a Thread's", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = await aChatThread(roleKey);
    const elsewhere = await answerIn(await aChatThread(roleKey), "Elsewhere.");

    const refused = await send("PUT", `/threads/${thread.id}/seen`, { messageId: elsewhere });

    expect(refused.status).toBe(422);
    expect(
      (await send("PUT", `/threads/${randomUUID()}/seen`, { messageId: elsewhere })).status,
    ).toBe(404);
  });

  it("says when each Thread last moved, and when the person's chat did", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = await aChatThread(roleKey);
    const started = threadSchema.parse(await (await get(`/threads/${thread.id}`)).json());
    expect(started.lastMovedAt).toBe(started.startedAt);

    await answerIn(thread, "Done.");

    const moved = threadSchema.parse(await (await get(`/threads/${thread.id}`)).json());
    expect(moved.lastMovedAt).not.toBe(started.startedAt);
    expect((await activityOf(roleKey))?.lastMovedAt).toBe(moved.lastMovedAt);
  });
});
