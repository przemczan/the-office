import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { recordLinksIn } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import { EngineCascade, OFFICE_MANAGER, RoleCards, type SessionRole } from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { LinkCardOfficeTools } from "../adapters/office-tools/link-card-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import type { Message } from "../domain/message.js";
import { chatOfficeTools, POST_LINK_CARD_TOOL } from "../domain/session-instructions.js";
import { startStageThread } from "../domain/thread-changes.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../ports/office-instructions-repository.js";
import { OfficeInstructions } from "./office-instructions.js";
import { ProjectBases } from "../ports/project-bases.js";
import { noProjectBases } from "../ports/project-bases.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { LinkCards } from "./link-cards.js";
import { MentionedRecords } from "./mentioned-records.js";
import { openPageRecordProviders } from "./open-page-records.fixtures.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { CallChains } from "./call-chains.js";
import { StageThreads } from "./stage-threads.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { ThreadContexts } from "./thread-contexts.js";
import { AllowChanges } from "./allow-changes.js";
import { ThreadRunner } from "./thread-runner.js";
import { ThreadService } from "./thread-service.js";
import { WorkRecords } from "./work-records.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { FireAlarmLifts } from "./fire-alarm-lifts.js";
import { ApprovalHolds } from "./approval-holds.js";
import { FireAlarmLiftRepository } from "../ports/fire-alarm-lift-repository.js";
import { PostgresFireAlarmLiftRepository } from "../adapters/postgres/postgres-fire-alarm-lift-repository.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { PostgresChangesAllowedRepository } from "../adapters/postgres/postgres-changes-allowed-repository.js";
import { sessionMcpServersStandIn } from "./session-mcp-servers.fixtures.js";
import { ProjectOutputMasks } from "../ports/project-output-masks.js";
import { ProjectOutputMasksForTests } from "../ports/project-output-masks.fixtures.js";
import { SubAgentsAndProcesses } from "./sub-agents-and-processes.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../adapters/postgres/postgres-sub-agent-and-process-repository.js";

const outputMasks = new ProjectOutputMasksForTests();

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };
const NOTE = "The mobile build has been slow since Tuesday. Can you check the build cache?";

let app: INestApplication;
let engine: ScriptedEngine;
let officeData: string;
let threads: ThreadService;
let runner: ThreadRunner;
let linkCards: LinkCards;
/** People of each test's own, so no other test file's Threads are theirs. */
let devopsKey: string;
let quietKey: string;
let goneKey: string;
let taskId: string;
/** The people let go so far, by their Role's key. */
let letGo: Set<string>;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-link-cards-"));
  devopsKey = `devops-${randomUUID()}`;
  quietKey = `quiet-${randomUUID()}`;
  goneKey = `gone-${randomUUID()}`;
  taskId = randomUUID();
  letGo = new Set([goneKey]);
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

function roleOf(roleKey: string): SessionRole | undefined {
  const cards: Record<string, SessionRole["card"]> = {
    [OFFICE_MANAGER]: aPlannerCard({ name: "Marta", title: "Office Manager" }),
    [devopsKey]: aPlannerCard({ name: "Nina", title: "Devops" }),
    [quietKey]: aPlannerCard({
      name: "Quinn",
      title: "Reviewer",
      capabilities: { sharedMemory: false, chat: false, consultant: false, runEnvironment: false },
    }),
  };
  const card = cards[roleKey];
  return card && !letGo.has(roleKey) ? { roleKey, cardVersion: 1, card } : undefined;
}

/** Boots the conversations on a scripted engine that replays `scripts`, one per session opened. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  engine = new ScriptedEngine(scripts);
  const noSkills = (sessionId: string): Awaited<ReturnType<SessionSkills["prepare"]>> => ({
    folder: join(officeData, "sessions", sessionId, "skills"),
    names: [],
    expected: [],
    overrides: {},
    versions: [],
    suffixMatches: [],
  });
  const sessionSkills: Pick<SessionSkills, "prepare" | "rebuild" | "forget"> = {
    prepare: ({ sessionId }) => Promise.resolve(noSkills(sessionId)),
    rebuild: (sessionId) => Promise.resolve(noSkills(sessionId)),
    forget: () => Promise.resolve(),
  };
  const roleCards: Pick<RoleCards, "find" | "findLetGo" | "forResumedSession" | "hiredKeys"> = {
    find: (key) => Promise.resolve(roleOf(key)),
    findLetGo: (key) => Promise.resolve(letGo.has(key) ? { name: "Sam" } : undefined),
    forResumedSession: (key) => Promise.resolve(roleOf(key) ?? Promise.reject(new Error(key))),
    hiredKeys: () =>
      Promise.resolve(
        new Set([OFFICE_MANAGER, devopsKey, quietKey].filter((key) => !letGo.has(key))),
      ),
  };
  const bases = noProjectBases(join(officeData, "bases"));
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ScriptedEngineModule.register(engine),
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: EngineCascade, useValue: new EngineCascadeStandIn() },
      { provide: ProjectBases, useValue: bases },
      { provide: ProjectOutputMasks, useValue: outputMasks },
      { provide: SessionSkills, useValue: sessionSkills },
      { provide: SessionMcpServers, useValue: sessionMcpServersStandIn().service },
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
      CallChains,
      ThreadContexts,
      AllowChanges,
      ThreadRunner,
      FireAlarmInThreads,
      FireAlarmLifts,
      ApprovalHolds,
      { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
      { provide: ChangesAllowedRepository, useClass: PostgresChangesAllowedRepository },
      MentionedRecords,
      ...openPageRecordProviders(),
      WorkRecords,
      StageThreads,
      {
        provide: SubAgentAndProcessRepository,
        useClass: PostgresSubAgentAndProcessRepository,
      },
      SubAgentsAndProcesses,
      LinkCards,
      LinkCardOfficeTools,
    ],
  }));
  // As the Projects, People and Work modules register the chat tools that read records.
  for (const name of chatOfficeTools(OFFICE_MANAGER)) {
    if (name === POST_LINK_CARD_TOOL) continue;
    app.get(OfficeToolRegistry).register({
      name,
      description: `Reads ${name}.`,
      input: z.object({}),
      run: () => Promise.resolve({ text: "Nothing.", isError: false }),
    });
  }
  app.get(WorkRecords).provide({
    taskRecord: () => Promise.resolve(undefined),
    taskTitle: (id) => Promise.resolve(id === taskId ? "Speed up the mobile build" : undefined),
    taskAttachmentIds: () => Promise.resolve([]),
    initiativeTaskAttachmentIds: () => Promise.resolve(undefined),
    initiativeRecord: () => Promise.resolve(undefined),
    initiativeName: () => Promise.resolve(undefined),
    projectWork: () => Promise.resolve({ taskIds: [], initiativeIds: [] }),
    ideaRecord: () => Promise.resolve(undefined),
  });
  threads = app.get(ThreadService);
  runner = app.get(ThreadRunner);
  linkCards = app.get(LinkCards);
}

/** The Office Manager posts a Link card with `input`, then ends their turn. */
function postsLinkCard(input: Record<string, unknown>): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId: "c-1",
        tool: POST_LINK_CARD_TOOL,
        officeTool: true,
        input,
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: {
        kind: "tool-result",
        callId: "c-1",
        text: "",
        isError: false,
        withinToolCall: undefined,
      },
    },
    ...endsTurn("That is Nina's area."),
  ];
}

function endsTurn(text: string): Step[] {
  return [
    { step: "event", event: { kind: "text", text, withinToolCall: undefined } },
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "completed",
        consumedMessageIds: ["brief"],
        usage: USAGE,
        sessionCostUsd: 0.01,
        output: undefined,
        errors: [],
      },
    },
    { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
  ];
}

/** The Office Manager's chat log once their turn ended, and its Link cards. */
async function askOfficeManager(text: string): Promise<{
  readonly log: readonly Message[];
  readonly cards: readonly Extract<Message, { kind: "link-card" }>[];
}> {
  const started = await threads.startInChat(OFFICE_MANAGER);
  await runner.send(started.id, text);
  await vi.waitFor(
    async () => {
      if ((await threads.read(started.id)).state !== "waiting") throw new Error("Answering.");
    },
    { timeout: 5_000, interval: 20 },
  );
  const log = await threads.messages(started.id);
  return { log, cards: log.flatMap((message) => (message.kind === "link-card" ? [message] : [])) };
}

/** What the Office Manager read back from their Office tool call. */
function toolResultRead(): { readonly text: string; readonly isError: boolean } {
  const result = engine.sessions
    .flatMap((session) => session.reportedEvents)
    .find((event) => event.kind === "tool-result");
  if (!result) throw new Error("No Office tool answered.");
  return { text: result.text, isError: result.isError };
}

describe("a Link card to a person", () => {
  it("shows in the chat with the Handover note, and their being let go once they are", async () => {
    await startWith(postsLinkCard({ person: devopsKey, note: ` ${NOTE} ` }));

    const { log, cards } = await askOfficeManager("The mobile build is slow.");

    expect(cards).toEqual([
      expect.objectContaining({
        roleKey: OFFICE_MANAGER,
        to: devopsKey,
        note: NOTE,
      }),
    ]);
    expect(cards[0]?.taskId).toBeUndefined();
    expect(toolResultRead().isError).toBe(false);
    expect(await linkCards.letGoIn(log)).toEqual(new Set());

    letGo.add(devopsKey);

    expect(await linkCards.letGoIn(log)).toEqual(new Set([devopsKey]));
  });

  it("is not posted for someone let go, and the Agent reads why", async () => {
    await startWith(postsLinkCard({ person: goneKey, note: NOTE }));

    const { cards } = await askOfficeManager("Who looks after the build?");

    expect(cards).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: expect.stringContaining("Sam was let go"),
      isError: true,
    });
  });

  it.each([
    [
      "a Role nobody fills",
      () => ({ person: "nobody", note: NOTE }),
      'Nobody fills the Role "nobody"',
    ],
    ["someone with Chat off", () => ({ person: quietKey, note: NOTE }), "Chat is off for Quinn"],
    ["a blank note", () => ({ person: devopsKey, note: "  " }), "Write the Handover note"],
    [
      "the Office Manager",
      () => ({ person: OFFICE_MANAGER, note: NOTE }),
      "talking to you already",
    ],
  ])("is not posted for %s, and the Agent reads why", async (_case, input, reason) => {
    await startWith(postsLinkCard(input()));

    const { cards } = await askOfficeManager("Who looks after the build?");

    expect(cards).toEqual([]);
    expect(toolResultRead()).toEqual({ text: expect.stringContaining(reason), isError: true });
  });
});

describe("a Link card about a Task", () => {
  it("points to whoever works its latest Stage, with a link to the Task in the note", async () => {
    await startWith(postsLinkCard({ task: taskId, note: NOTE }));
    const { thread } = startStageThread(
      randomUUID(),
      { taskId, roleKey: devopsKey, title: "Implement · Nina" },
      new Date(),
    );
    await app.get(ThreadRepository).add(thread);

    const { cards } = await askOfficeManager("How is the mobile build Task going?");

    expect(cards).toEqual([
      expect.objectContaining({
        to: devopsKey,
        taskId,
        note: `${NOTE}\n\n[Speed up the mobile build](/tasks/${taskId})`,
      }),
    ]);
    // Sent by the user, the note mentions the Task as the web's own links do.
    expect(recordLinksIn(cards[0]?.note ?? "")).toEqual([{ kind: "task", taskId }]);
  });

  it("is not posted for a Task The Office doesn't have, and the Agent reads why", async () => {
    const missing = randomUUID();
    await startWith(postsLinkCard({ task: missing, person: devopsKey, note: NOTE }));

    const { cards } = await askOfficeManager("How is that Task going?");

    expect(cards).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: `The Office has no Task ${missing}.`,
      isError: true,
    });
  });

  it("is not posted when nobody has worked one of its Stages and no person is named", async () => {
    await startWith(postsLinkCard({ task: taskId, note: NOTE }));

    const { cards } = await askOfficeManager("How is the mobile build Task going?");

    expect(cards).toEqual([]);
    expect(toolResultRead().text).toContain(
      "Nobody has worked a Stage of Speed up the mobile build",
    );
  });
});
