import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { ContractMessageImageRules } from "../adapters/http/contract-message-image-rules.js";
import { MessageImageRules } from "../ports/message-image-rules.js";
import { MessageImages } from "./message-images.js";
import { ThreadImages } from "./thread-images.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  RoleNotFound,
  EngineCascade,
  PeopleModule,
  RoleCards,
  RoleService,
  type SessionRole,
} from "../../people/index.js";
import { BusyWorkModule } from "../../office-updates/index.js";
import { OfficeInstructionsChanged } from "../domain/conversation-events.js";
import { aProposedCard } from "../domain/proposal.fixtures.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactoryProvider, INestApplication } from "@nestjs/common";
import { z } from "zod";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { ScheduleModule } from "../../../platform/schedule/schedule.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  EngineModule,
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { skillCommandsProvider } from "./skill-commands.fixtures.js";
import { ProposalOfficeTools } from "../adapters/office-tools/proposal-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { OfficeInstructionsProposals } from "../adapters/proposals/office-instructions-proposals.js";
import { SizeThresholdProposals } from "../adapters/proposals/size-threshold-proposals.js";
import type { Proposal, ProposedSettingChange } from "../domain/proposal.js";
import {
  chatOfficeTools,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_ROLE_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
  READ_ROLE_TOOL,
} from "../domain/session-instructions.js";
import type { Thread } from "../domain/thread.js";
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
import { MentionedRecords } from "./mentioned-records.js";
import { openPageRecordProviders } from "./open-page-records.fixtures.js";
import { ProposalAppliers } from "./proposal-appliers.js";
import { ProposalService } from "./proposal-service.js";
import { RoleProposals } from "./role-proposals.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { dutiesProvider } from "./duties.fixtures.js";
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
import { SessionStops } from "./session-stops.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../adapters/postgres/postgres-sub-agent-and-process-repository.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import { ANN_LEE } from "../domain/user.fixtures.js";
import { ConversationsPromptTemplatesForTests } from "../adapters/prompt-templates/conversations-prompt-templates.fixtures.js";

/** The Role holding Default person to talk to by default. */
const OFFICE_MANAGER = "office-manager";

// What proposal-service.test.ts and proposal-service.full.test.ts share.

const outputMasks = new ProjectOutputMasksForTests();

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

// The Office Manager's chat is keyed by the preset's fixed key, which only roles.controller.test
// may hire into (apps/service/docs/testing.md): here People's RoleCards stand in for them, while
// the Roles they propose are hired and changed through the real People module, each test's own.
const OFFICE_MANAGER_ROLE: SessionRole = {
  roleKey: OFFICE_MANAGER,
  cardVersion: 1,
  mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
  card: aPlannerCard({ name: "Marta", title: "Office Manager" }),
};

let app: INestApplication;

let engine: ScriptedEngine;

let officeData: string;

let threads: ThreadService;

let runner: ThreadRunner;

let proposals: ProposalService;

let roles: RoleService;

let officeInstructions: OfficeInstructions;

let officeWideLimit: OfficeWideLimitStandIn;

/** A Role title of each test's own, so its Role key, which People makes from it, is too. */
let title: string;

let roleKey: string;

/**
 * Boots the conversations and People on a scripted engine that replays `scripts`, which People's
 * Office tools register on too.
 */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  engine = new ScriptedEngine(scripts);
  const scriptedEngine = ScriptedEngineModule.register(engine);
  officeWideLimit = new OfficeWideLimitStandIn();
  const sessionSkills: Pick<SessionSkills, "prepare" | "rebuild" | "forget"> = {
    prepare: ({ sessionId }) => Promise.resolve(noSkills(sessionId)),
    rebuild: (sessionId) => Promise.resolve(noSkills(sessionId)),
    forget: () => Promise.resolve(),
  };
  const roleCards: Pick<RoleCards, "find" | "forResumedSession" | "hiredKeys"> = {
    find: (key) => Promise.resolve(key === OFFICE_MANAGER ? OFFICE_MANAGER_ROLE : undefined),
    forResumedSession: () => Promise.resolve(OFFICE_MANAGER_ROLE),
    hiredKeys: () => Promise.resolve(new Set([OFFICE_MANAGER])),
  };
  const bases = noProjectBases(join(officeData, "bases"));
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      ConversationsPromptTemplatesForTests,
      EventsModule,
      ScheduleModule,
      BusyWorkModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      EngineModule,
      PeopleModule,
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: ProjectBases, useValue: bases },
      { provide: ProjectOutputMasks, useValue: outputMasks },
      { provide: SessionSkills, useValue: sessionSkills },
      skillCommandsProvider(),
      { provide: EngineCascade, useValue: new EngineCascadeStandIn() },
      { provide: SessionMcpServers, useValue: sessionMcpServersStandIn().service },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      { provide: OfficeInstructionsRepository, useClass: OfficeInstructionsRepositoryForTests },
      OfficeInstructions,
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      MessageImages,
      ThreadImages,
      { provide: MessageImageRules, useClass: ContractMessageImageRules },
      sessionMemoryProvider(),
      // People's own reads the Roles hired here, none under the Office Manager's fixed key.
      dutiesProvider(),
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
      SessionStops,
      ProposalAppliers,
      ProposalService,
      RoleProposals,
      SizeThresholdProposals,
      OfficeInstructionsProposals,
      ProposalOfficeTools,
      chatToolStandIns(),
      {
        provide: "office-wide limit proposals",
        inject: [ProposalAppliers],
        useFactory: (appliers: ProposalAppliers) => {
          appliers.registerSetting("office-wide-limit", officeWideLimit);
          return appliers;
        },
      },
    ],
    overrides: [{ provide: RoleCards, useValue: roleCards }],
    moduleOverrides: [{ module: EngineModule, useModule: scriptedEngine }],
  }));
  threads = app.get(ThreadService);
  runner = app.get(ThreadRunner);
  proposals = app.get(ProposalService);
  roles = app.get(RoleService);
  officeInstructions = app.get(OfficeInstructions);
}

/** Work's applier of the Office-wide limit, which Work registers as it starts (a module apart). */
class OfficeWideLimitStandIn {
  limit = 3;
  readonly applied: { change: ProposedSettingChange<"office-wide-limit">; by: string }[] = [];

  valueNow(): Promise<number> {
    return Promise.resolve(this.limit);
  }

  problemsWith({ to }: ProposedSettingChange): Promise<readonly string[]> {
    return Promise.resolve(to === this.limit ? [`The Office-wide limit is ${to} already.`] : []);
  }

  apply(
    change: ProposedSettingChange<"office-wide-limit">,
    by: string,
  ): Promise<ProposedSettingChange<"office-wide-limit">> {
    this.limit = change.to;
    this.applied.push({ change, by });
    return Promise.resolve(change);
  }
}

const TOOLS_OF_PROPOSAL_OFFICE_TOOLS: readonly string[] = [
  PROPOSE_ROLE_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
];

/** People's own, which PeopleModule, booted here for its Roles, registers on the sessions' registry. */
const TOOLS_OF_PEOPLE: readonly string[] = ["list_people", READ_ROLE_TOOL];

/** The chat tools that read records, as the Projects and Work modules register them. */
function chatToolStandIns(): FactoryProvider {
  return {
    provide: "chat tool stand-ins",
    inject: [OfficeToolRegistry],
    useFactory: (registry: OfficeToolRegistry) => {
      for (const name of chatOfficeTools(["default-person-to-talk-to"])) {
        if (TOOLS_OF_PROPOSAL_OFFICE_TOOLS.includes(name) || TOOLS_OF_PEOPLE.includes(name)) {
          continue;
        }
        registry.register({
          name,
          description: `Reads ${name}.`,
          input: z.object({}),
          run: () => Promise.resolve({ text: "Nothing.", isError: false }),
        });
      }
      return registry;
    },
  };
}

function noSkills(sessionId: string): Awaited<ReturnType<SessionSkills["prepare"]>> {
  return {
    folder: join(officeData, "sessions", sessionId, "skills"),
    names: [],
    expected: [],
    userOnly: [],
    overrides: {},
    versions: [],
    suffixMatches: [],
  };
}

/** The Office Manager proposes a Role with `input`, then ends their turn. */
function proposes(input: Record<string, unknown>): SessionScript {
  return calls(PROPOSE_ROLE_TOOL, input);
}

/** The Office Manager calls the Office tool `tool` with `input`, then ends their turn. */
function calls(tool: string, input: Record<string, unknown>): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    ...officeToolCall("c-1", tool, input),
    ...endsTurn("Here is the card."),
  ];
}

function officeToolCall(callId: string, tool: string, input: Record<string, unknown>): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool,
        officeTool: true,
        input,
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: { kind: "tool-result", callId, text: "", isError: false, withinToolCall: undefined },
    },
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

/** The Office Manager's chat Thread once their turn ended, and the Proposals drafted in it. */
async function askOfficeManager(text: string): Promise<{
  readonly thread: Thread;
  readonly drafted: readonly Proposal[];
}> {
  const started = await threads.startInChat(OFFICE_MANAGER);
  await runner.send(started.id, text, ANN_LEE);
  const thread = await vi.waitFor(
    async () => {
      const read = await threads.read(started.id);
      if (read.state !== "waiting") throw new Error("Still answering.");
      return read;
    },
    { timeout: 5_000, interval: 20 },
  );
  return { thread, drafted: await proposals.listInThread(thread.id) };
}

async function theOnlyProposal(text: string): Promise<Proposal> {
  const { drafted } = await askOfficeManager(text);
  const [proposal] = drafted;
  if (!proposal || drafted.length > 1) throw new Error("Not one Proposal was drafted.");
  return proposal;
}

function drafts(text: string): SessionScript {
  return calls(PROPOSE_OFFICE_SETTING_TOOL, { setting: "office-instructions", text });
}

/** Starts on the text `now`, with the Office Manager's draft of `text` open. */
async function draftOver(now: string, text: string): Promise<Proposal> {
  await startWith(drafts(text));
  await officeInstructions.save(now, ANN_LEE);
  return theOnlyProposal("Ask for plain words.");
}

/** The hooks every test of both files runs. */
function setUpEachTest(): void {
  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-proposals-"));
    const suffix = randomUUID().slice(0, 8);
    title = `Tester ${suffix}`;
    roleKey = `tester-${suffix}`;
  });

  afterEach(async () => {
    await app.close();
    await rm(officeData, { recursive: true, force: true });
  });
}

setUpEachTest();

describe("a Proposal of a new Role", () => {
  it("shows as a card in the chat, and hires the Role, as edited, only when the user applies it", async () => {
    const card = aProposedCard({ title });
    await startWith(proposes({ card }));

    const { thread, drafted } = await askOfficeManager("We need someone to test the changes.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");

    expect(proposal).toMatchObject({
      draftedBy: OFFICE_MANAGER,
      change: { kind: "hire", card, skills: [], roleKey: undefined },
      status: { kind: "open" },
    });
    const log = await threads.messages(thread.id);
    expect(log.filter(({ kind }) => kind === "proposal")).toEqual([
      expect.objectContaining({ roleKey: OFFICE_MANAGER, proposalId: proposal.id }),
    ]);
    await expect(roles.read(roleKey)).rejects.toThrow(RoleNotFound);

    const applied = await proposals.apply(proposal.id, ANN_LEE, {
      kind: "hire",
      card: { ...card, name: "Tom" },
      skills: [],
    });

    expect(applied).toMatchObject({
      change: { kind: "hire", card: { name: "Tom" }, roleKey },
      status: { kind: "applied" },
    });
    expect((await roles.read(roleKey)).role.card.name).toBe("Tom");
    expect(await roles.history(roleKey)).toEqual([
      { kind: "hired", at: expect.any(Date), proposedBy: OFFICE_MANAGER, savedBy: ANN_LEE },
    ]);
    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toThrow(
      "This Proposal is applied already.",
    );
  });
});

describe("a Proposal of the Office instructions", () => {
  it("is refused once the text changed since the draft, keeping the edit and staying open", async () => {
    const proposal = await draftOver("Write in plain words.", "Keep it short.");
    await officeInstructions.save("Edited in Settings.", ANN_LEE);
    const announced: OfficeInstructionsChanged[] = [];
    app.get(EventBus).subscribe(OfficeInstructionsChanged, (event) => {
      announced.push(event);
    });

    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toMatchObject({
      reasons: [expect.stringContaining("Ask for a new draft.")],
    });

    expect(await officeInstructions.current()).toEqual({
      version: 2,
      text: "Edited in Settings.",
    });
    expect(announced).toEqual([]);
    expect((await proposals.read(proposal.id)).status).toEqual({ kind: "open" });
  });
});
