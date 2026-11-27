import { OFFICE_ACTIONS, OFFICE_INSTRUCTIONS_MAX_CHARACTERS } from "@the-office/contracts";
import { ContractMessageImageRules } from "../adapters/http/contract-message-image-rules.js";
import { MessageImageRules } from "../ports/message-image-rules.js";
import { MessageImages } from "./message-images.js";
import { ThreadImages } from "./thread-images.js";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  sessionRole,
  CARETAKER,
  Duties,
  EngineCascade,
  PeopleModule,
  RoleCards,
  RoleNotFound,
  RoleService,
  type SessionRole,
} from "../../people/index.js";
import { BusyWorkModule } from "../../busy-work/index.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../domain/context-policy.js";
import { OfficeInstructionsChanged } from "../domain/conversation-events.js";
import { aProposedCard } from "../domain/proposal.fixtures.js";
import {
  PROPOSE_OFFICE_SETUP_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
  READ_ROLE_TOOL,
  caretakerChatOfficeTools,
  chatOfficeTools,
} from "../domain/session-instructions.js";
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
  CORE_AREA,
  EngineModule,
  OfficeToolRegistry,
  type OfficeTool,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import {
  DutyRepository,
  DutyRepositoryForTests,
  EngineCascadeStandIn,
  OfficeSetupRepository,
  OfficeSetupRepositoryForTests,
  RoleRepository,
} from "../../people/index.fixtures.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import {
  PromptTemplateCatalog,
  PromptTemplates,
  PromptTemplatesModule,
  promptTemplate,
} from "../../prompt-templates/index.js";
import {
  PromptTemplateRepository,
  PromptTemplateRepositoryForTests,
} from "../../prompt-templates/index.fixtures.js";
import { SessionSkills, SkillLibrary } from "../../skills/index.js";
import { skillCommandsProvider } from "./skill-commands.fixtures.js";
import { PromptTemplateOfficeTools } from "../adapters/office-tools/prompt-template-office-tools.js";
import { ProposalOfficeTools } from "../adapters/office-tools/proposal-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { DutyProposals } from "../adapters/proposals/duty-proposals.js";
import { OfficeInstructionsProposals } from "../adapters/proposals/office-instructions-proposals.js";
import { PromptTemplateProposals } from "../adapters/proposals/prompt-template-proposals.js";
import { SizeThresholdProposals } from "../adapters/proposals/size-threshold-proposals.js";
import type { Proposal, ProposedChange, ProposedSettingChange } from "../domain/proposal.js";
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
import { OfficeActionProposals } from "./office-action-proposals.js";
import { ProposalAppliers } from "./proposal-appliers.js";
import { ProposalService } from "./proposal-service.js";
import { RoleProposals } from "./role-proposals.js";
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
import { RunEveryOfficeToolCall } from "./approval-holds.fixtures.js";
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
import { ANN_LEE, BEN_ITO } from "../domain/user.fixtures.js";
import { ConversationsPromptTemplatesForTests } from "../adapters/prompt-templates/conversations-prompt-templates.fixtures.js";

/** The Role holding Default person to talk to by default. */
const OFFICE_MANAGER = "office-manager";
/** The effort High on Claude Code, with its default model. */
const HIGH_ON_CLAUDE_CODE = { "claude-code": { model: null, effort: "high" as const } };

// What proposal-service.test.ts and proposal-service.full.test.ts share.

const outputMasks = new ProjectOutputMasksForTests();

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

// The Office Manager's chat is keyed by the preset's fixed key, which only roles.controller.test
// may hire into (apps/service/docs/testing.md): here People's RoleCards stand in for them, while
// the Roles they propose are hired and changed through the real People module, each test's own.
const OFFICE_MANAGER_ROLE: SessionRole = sessionRole(
  OFFICE_MANAGER,
  1,
  aPlannerCard({ name: "Marta", title: "Office Manager" }),
  MCP_TOOL_DEFAULT_STAND_IN,
);

// The Caretaker's card, as People's RoleCards stand in for it too.
const CARETAKER_ROLE: SessionRole = sessionRole(
  CARETAKER,
  1,
  aPlannerCard({ name: "Sam", title: "Caretaker" }),
  MCP_TOOL_DEFAULT_STAND_IN,
);

let app: INestApplication;

let engine: ScriptedEngine;

let officeData: string;

let threads: ThreadService;

let runner: ThreadRunner;

let proposals: ProposalService;

let roles: RoleService;

let settings: ContextPolicySettingsService;

let officeInstructions: OfficeInstructions;

let duties: Duties;

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
    find: (key) =>
      Promise.resolve(
        key === OFFICE_MANAGER
          ? OFFICE_MANAGER_ROLE
          : key === CARETAKER
            ? CARETAKER_ROLE
            : undefined,
      ),
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
      PromptTemplatesModule,
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
      RunEveryOfficeToolCall,
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
      DutyProposals,
      OfficeActionProposals,
      ProposalOfficeTools,
      PromptTemplateProposals,
      PromptTemplateOfficeTools,
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
    // Every test file shares the stored duties, which decide who other files' sessions consult.
    overrides: [
      { provide: RoleCards, useValue: roleCards },
      { provide: DutyRepository, useValue: new DutyRepositoryForTests() },
      // As every test file shares the templates' stored versions.
      { provide: PromptTemplateRepository, useValue: new PromptTemplateRepositoryForTests() },
      // A set-up's duties are kept on the duties above, never on the shared database.
      {
        provide: OfficeSetupRepository,
        inject: [RoleRepository, DutyRepository],
        useFactory: (roleRepository: RoleRepository, dutyRepository: DutyRepository) =>
          new OfficeSetupRepositoryForTests(roleRepository, dutyRepository),
      },
    ],
    moduleOverrides: [{ module: EngineModule, useModule: scriptedEngine }],
  }));
  threads = app.get(ThreadService);
  runner = app.get(ThreadRunner);
  proposals = app.get(ProposalService);
  roles = app.get(RoleService);
  settings = app.get(ContextPolicySettingsService);
  officeInstructions = app.get(OfficeInstructions);
  duties = app.get(Duties);
  // The Office Manager stands in through RoleCards, hired nowhere People's own Duties reads, so
  // they hold Default person to talk to as the preset does by default.
  const heldBy = duties.heldBy.bind(duties);
  vi.spyOn(duties, "heldBy").mockImplementation((key) =>
    key === OFFICE_MANAGER ? Promise.resolve(["default-person-to-talk-to"]) : heldBy(key),
  );
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
  PROPOSE_OFFICE_SETUP_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
];

const TOOLS_OF_PROMPT_TEMPLATE_OFFICE_TOOLS: readonly string[] = chatOfficeTools().filter((name) =>
  name.includes("prompt_template"),
);

/** People's own, which PeopleModule, booted here for its Roles, registers on the sessions' registry. */
const TOOLS_OF_PEOPLE: readonly string[] = ["list_people", READ_ROLE_TOOL];

/** The chat tools that read records, as the Projects and Work modules register them. */
function chatToolStandIns(): FactoryProvider {
  return {
    provide: "chat tool stand-ins",
    inject: [OfficeToolRegistry],
    useFactory: (registry: OfficeToolRegistry) => {
      const names = new Set([...chatOfficeTools(), ...caretakerChatOfficeTools()]);
      for (const name of names) {
        if (
          TOOLS_OF_PROPOSAL_OFFICE_TOOLS.includes(name) ||
          TOOLS_OF_PROMPT_TEMPLATE_OFFICE_TOOLS.includes(name) ||
          TOOLS_OF_PEOPLE.includes(name)
        ) {
          continue;
        }
        registry.register({
          name,
          area: "core",
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

/** Starts on a Thread of the Office Manager's that drafts nothing by itself. */
function startsIdle(): Promise<void> {
  return startWith([
    { step: "start", brief: { id: "brief", text: "" } },
    ...endsTurn("Nothing to draft."),
  ]);
}

/**
 * Drafts a Proposal of `change` in the Office Manager's chat, as `propose_role`, now retired,
 * drafted them: one still open applies as before. Start with `startsIdle` first.
 */
async function draftsRole(change: ProposedChange): Promise<Proposal> {
  const { thread } = await askOfficeManager("We need a person for this.");
  if (!thread.session) throw new Error("The chat has no session.");
  return proposals.draft(thread.session.id, change);
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
  return ask(OFFICE_MANAGER, text);
}

/** The chat Thread of the person keyed `asked` once their turn ended, with its Proposals. */
async function ask(
  asked: string,
  text: string,
): Promise<{ readonly thread: Thread; readonly drafted: readonly Proposal[] }> {
  const started = await threads.startInChat(asked);
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

/**
 * Starts on the text `now`, with an open Proposal of `text` as `propose_office_setting`, now
 * retired, drafted it: it applies as before.
 */
async function draftOver(now: string, text: string): Promise<Proposal> {
  await startsIdle();
  await officeInstructions.save(now, ANN_LEE);
  return draftsRole({ kind: "office-instructions", from: now, to: text });
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

/** What the Office Manager read back from their Office tool call `callId`. */
function toolResultRead(callId = "c-1"): { readonly text: string; readonly isError: boolean } {
  const result = engine.sessions
    .flatMap((session) => session.reportedEvents)
    .filter((event) => event.kind === "tool-result")
    .find((event) => event.callId === callId);
  if (!result) throw new Error("No Office tool answered.");
  return { text: result.text, isError: result.isError };
}

describe("a Proposal of a new Role", () => {
  it("stays open with People's reasons when hiring is refused", async () => {
    const card = aProposedCard({ title });
    await startsIdle();
    const proposal = await draftsRole({ kind: "hire", card, skills: [], roleKey: undefined });

    await expect(
      proposals.apply(proposal.id, ANN_LEE, {
        kind: "hire",
        card: { ...card, name: "" },
        skills: [],
      }),
    ).rejects.toThrow("Give the person a name.");

    expect((await proposals.read(proposal.id)).status).toEqual({ kind: "open" });
  });
});

// A preset's Role has the preset's fixed key, which only roles.controller.test may hire into
// (apps/service/docs/testing.md): here People's preset hiring stands in, and its rules are
// role-changes.test's.
describe("a Proposal of a person in a preset's Role", () => {
  it("hires them, under the name the user gave, only when the user applies it", async () => {
    await startsIdle();
    const presetHiringProblems = vi.spyOn(roles, "presetHiringProblems").mockResolvedValue([]);
    const hire = vi
      .spyOn(roles, "hire")
      .mockImplementation((key, name) =>
        Promise.resolve({ role: { key, card: { name: name.trim() } }, skills: [] } as never),
      );

    const proposal = await draftsRole({
      kind: "hire-from-preset",
      roleKey: "developer",
      name: "Ada",
    });

    expect(proposal.change).toEqual({
      kind: "hire-from-preset",
      roleKey: "developer",
      name: "Ada",
    });
    expect(presetHiringProblems).toHaveBeenCalledWith("developer", "Ada");
    expect(hire).not.toHaveBeenCalled();

    const applied = await proposals.apply(proposal.id, ANN_LEE, {
      kind: "hire-from-preset",
      name: " Grace ",
    });

    expect(hire).toHaveBeenCalledWith("developer", " Grace ", ANN_LEE, OFFICE_MANAGER);
    expect(applied).toMatchObject({
      change: { kind: "hire-from-preset", roleKey: "developer", name: "Grace" },
      status: { kind: "applied" },
    });
  });
});

describe("a Proposal of the size threshold", () => {
  const { sizeThreshold } = DEFAULT_CONTEXT_POLICY_SETTINGS;

  /** An open Proposal as `propose_office_setting`, now retired, drafted it: it applies as before. */
  async function draftsThreshold(to: number): Promise<Proposal> {
    await startsIdle();
    return draftsRole({ kind: "size-threshold", from: sizeThreshold, to });
  }

  it("still applies when it was drafted before the Office actions replaced its tool, from the value it had, only when the user applies it", async () => {
    const proposal = await draftsThreshold(60_000);

    expect(proposal.change).toEqual({ kind: "size-threshold", from: sizeThreshold, to: 60_000 });
    expect(await settings.sizeThreshold()).toBe(sizeThreshold);

    await proposals.apply(proposal.id, ANN_LEE);

    expect(await settings.sizeThreshold()).toBe(60_000);
    expect((await proposals.read(proposal.id)).status).toMatchObject({ kind: "applied" });
  });

  it("changes nothing when the user declines it", async () => {
    const proposal = await draftsThreshold(60_000);

    await proposals.decline(proposal.id, ANN_LEE);

    expect(await settings.sizeThreshold()).toBe(sizeThreshold);
  });

  it("is not drafted on a value Settings would refuse, and the reason is given", async () => {
    await expect(draftsThreshold(1_234)).rejects.toMatchObject({
      reasons: ["The size threshold is from 5000 to 200000 tokens, in steps of 5000."],
    });

    expect(await settings.sizeThreshold()).toBe(sizeThreshold);
  });
});

describe("a Proposal of the Office-wide limit", () => {
  it("is applied by Work, from the limit it keeps, saying who proposed it", async () => {
    const proposal = await draftsLimit(5);

    expect(proposal.change).toEqual({ kind: "office-wide-limit", from: 3, to: 5 });
    expect(officeWideLimit.applied).toEqual([]);

    await proposals.apply(proposal.id, ANN_LEE);

    expect(officeWideLimit.applied).toEqual([
      { change: { kind: "office-wide-limit", from: 3, to: 5 }, by: OFFICE_MANAGER },
    ]);
  });

  it("changes nothing when the user declines it", async () => {
    const proposal = await draftsLimit(5);

    await proposals.decline(proposal.id, ANN_LEE);

    expect(officeWideLimit.limit).toBe(3);
    expect(officeWideLimit.applied).toEqual([]);
  });

  it("is not drafted when Work would refuse it, and the reason is given", async () => {
    await expect(draftsLimit(3)).rejects.toMatchObject({
      reasons: ["The Office-wide limit is 3 already."],
    });
  });
});

describe("a Proposal of the Office instructions", () => {
  it("is drafted from the text now, and changes it only when the user applies it", async () => {
    const proposal = await draftOver("Write in plain words.", "Keep it short.");

    expect(proposal.change).toEqual({
      kind: "office-instructions",
      from: "Write in plain words.",
      to: "Keep it short.",
    });
    expect(await officeInstructions.current()).toEqual({
      version: 1,
      text: "Write in plain words.",
    });
  });

  it("saves a new version and announces it when the user applies it", async () => {
    const proposal = await draftOver("Write in plain words.", "Keep it short.");
    const announced: OfficeInstructionsChanged[] = [];
    app.get(EventBus).subscribe(OfficeInstructionsChanged, (event) => {
      announced.push(event);
    });

    await proposals.apply(proposal.id, ANN_LEE);

    expect(await officeInstructions.current()).toEqual({ version: 2, text: "Keep it short." });
    expect(announced).toEqual([expect.objectContaining({ version: 2 })]);
    expect((await proposals.read(proposal.id)).status).toMatchObject({ kind: "applied" });
  });

  it("is applied over no text at all", async () => {
    const proposal = await draftOver("", "Keep it short.");

    await proposals.apply(proposal.id, ANN_LEE);

    expect(await officeInstructions.current()).toEqual({ version: 1, text: "Keep it short." });
  });

  it("empties them when an empty text is applied", async () => {
    const proposal = await draftOver("Write in plain words.", "");

    await proposals.apply(proposal.id, ANN_LEE);

    expect(await officeInstructions.current()).toEqual({ version: 2, text: "" });
  });

  it("is not drafted on the text they are now", async () => {
    await expect(draftOver("Write in plain words.", "Write in plain words.")).rejects.toMatchObject(
      {
        reasons: ["The Office instructions are this text already."],
      },
    );
  });

  it("is not drafted over the limit, and the reason is given", async () => {
    await expect(
      draftOver("Write in plain words.", "a".repeat(OFFICE_INSTRUCTIONS_MAX_CHARACTERS + 1)),
    ).rejects.toMatchObject({
      reasons: [
        `The Office instructions are at most ${OFFICE_INSTRUCTIONS_MAX_CHARACTERS} characters.`,
      ],
    });
  });

  it("lets the Office Manager read the text now, newer than their session's", async () => {
    await startWith(calls(READ_OFFICE_INSTRUCTIONS_TOOL, {}));
    await officeInstructions.save("Write in plain words.", ANN_LEE);

    await askOfficeManager("What do the Office instructions say?");

    expect(toolResultRead()).toEqual({ text: "Write in plain words.", isError: false });
  });
});

describe("a Proposal of a prompt template", () => {
  const greeting = promptTemplate({
    key: "conversations.a-greeting",
    domain: "conversations",
    name: "A greeting",
    description: "Greets the user.",
    variables: { userName: { kind: "text", description: "The user's name." } },
    text: "Hello {{userName}}.",
  });

  /** An open Proposal as `propose_prompt_template`, now retired, drafted it: it applies as before. */
  async function draftsPromptTemplate(
    to: string,
  ): Promise<{ templates: PromptTemplates; proposal: Proposal }> {
    await startsIdle();
    app.get(PromptTemplateCatalog).register([greeting]);
    const proposal = await draftsRole({
      kind: "prompt-template",
      key: greeting.key,
      name: "A greeting",
      from: "Hello {{userName}}.",
      to,
    });
    return { templates: app.get(PromptTemplates), proposal };
  }

  it("still applies when it was drafted before the Office actions replaced its tool, saved with who applied it", async () => {
    const { templates, proposal } = await draftsPromptTemplate("Hi {{userName}}.");

    expect((await templates.read(greeting.key)).customised).toBe(false);

    await proposals.apply(proposal.id, ANN_LEE);

    expect(await templates.read(greeting.key)).toMatchObject({
      text: "Hi {{userName}}.",
      saved: { version: 1, savedBy: ANN_LEE },
    });
    expect((await proposals.read(proposal.id)).status).toMatchObject({ kind: "applied" });
  });

  it("is refused once the template changed since the draft, and stays open", async () => {
    const { templates, proposal } = await draftsPromptTemplate("Hi {{userName}}.");
    await templates.save(greeting.key, "Hey {{userName}}.", ANN_LEE);

    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toThrow(
      "The prompt template changed after this was drafted",
    );

    expect((await proposals.read(proposal.id)).status).toEqual({ kind: "open" });
    expect((await templates.read(greeting.key)).text).toBe("Hey {{userName}}.");
  });
});

/** The change that gives the tester effort High on Claude Code. */
const highEffort = (): ProposedChange => ({
  kind: "change",
  roleKey,
  from: { engineSettings: {} },
  to: { engineSettings: HIGH_ON_CLAUDE_CODE },
});

describe("a Proposal of a change to a Role", () => {
  it("changes only the fields it names, when the user applies it, saying who proposed it and who applied it", async () => {
    await startsIdle();
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);
    const proposal = await draftsRole(highEffort());

    expect(proposal.change).toEqual({
      kind: "change",
      roleKey,
      from: { engineSettings: {} },
      to: { engineSettings: HIGH_ON_CLAUDE_CODE },
    });
    expect((await roles.read(roleKey)).role.card.engineSettings).toEqual({});
    // The user renames the person meanwhile: applying keeps that.
    const { role: renamed, skills } = await roles.read(roleKey);
    await roles.changeCard(roleKey, { ...renamed.card, name: "Tom" }, skills, ANN_LEE);

    await proposals.apply(proposal.id, BEN_ITO);

    expect((await roles.read(roleKey)).role.card).toMatchObject({
      name: "Tom",
      engineSettings: HIGH_ON_CLAUDE_CODE,
    });
    const [latest, byTheUser] = await roles.history(roleKey);
    expect(latest).toMatchObject({
      kind: "card-changed",
      changes: [{ field: "engineSettings", from: {}, to: HIGH_ON_CLAUDE_CODE }],
      proposedBy: OFFICE_MANAGER,
      savedBy: BEN_ITO,
    });
    expect(byTheUser).toMatchObject({
      kind: "card-changed",
      proposedBy: undefined,
      savedBy: ANN_LEE,
    });
  });

  it("changes nothing when the user declines it", async () => {
    await startsIdle();
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);
    const proposal = await draftsRole(highEffort());

    const declined = await proposals.decline(proposal.id, ANN_LEE);

    expect(declined.status).toMatchObject({ kind: "declined" });
    expect((await roles.read(roleKey)).role.cardVersion).toBe(1);
    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toThrow(
      "This Proposal was declined.",
    );
  });
});

/**
 * An open Proposal of the duties' new holders, each `[duty, holder]`, as `propose_office_setting`,
 * now retired, drafted it: its `from` is each duty's holder now. Start with `startsIdle` first.
 */
async function proposesHolders(...holders: [string, string | null][]): Promise<Proposal> {
  const now = await duties.list();
  const from = Object.fromEntries(
    holders.map(([duty]) => [duty, now.find((holding) => holding.duty === duty)?.roleKey ?? null]),
  );
  return draftsRole({ kind: "duties", from, to: Object.fromEntries(holders) });
}

async function holdersOf(...named: string[]): Promise<Record<string, string | null>> {
  const now = await duties.list();
  return Object.fromEntries(
    now
      .filter(({ duty }) => named.includes(duty))
      .map((holding) => [holding.duty, holding.roleKey]),
  );
}

describe("a Proposal of who holds the duties", () => {
  it("still applies when it was drafted before the Office actions replaced its tool: from the holders it named, changing nothing until then", async () => {
    await startsIdle();
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);

    const proposal = await proposesHolders(["plans", roleKey], ["reviews", null]);

    expect(proposal.change).toEqual({
      kind: "duties",
      from: { plans: "planner", reviews: "reviewer" },
      to: { plans: roleKey, reviews: null },
    });
    expect(await holdersOf("plans", "reviews")).toEqual({ plans: "planner", reviews: "reviewer" });
  });

  it("sets every duty it names when the user applies it", async () => {
    await startsIdle();
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);
    const proposal = await proposesHolders(["plans", roleKey], ["shapes-initiatives", roleKey]);

    const applied = await proposals.apply(proposal.id, ANN_LEE);

    expect(applied.status).toMatchObject({ kind: "applied" });
    expect(await holdersOf("plans", "shapes-initiatives")).toEqual({
      plans: roleKey,
      "shapes-initiatives": roleKey,
    });
  });

  it("is refused once a duty it names changed since, and changes none of them", async () => {
    await startsIdle();
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);
    const proposal = await proposesHolders(["plans", roleKey], ["shapes-initiatives", roleKey]);
    await duties.change("shapes-initiatives", null);

    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toThrow(
      "Shapes Initiatives was changed meanwhile, so this change no longer applies.",
    );

    expect(await holdersOf("plans", "shapes-initiatives")).toEqual({
      plans: "planner",
      "shapes-initiatives": null,
    });
    expect((await proposals.read(proposal.id)).status).toEqual({ kind: "open" });
  });

  it("is not drafted for a Role nobody is hired as, and the reason is given", async () => {
    await startsIdle();

    await expect(proposesHolders(["plans", roleKey])).rejects.toMatchObject({
      reasons: [`Plans goes to a hired Role, and nobody is hired as "${roleKey}".`],
    });
  });

  it("is not drafted for the Caretaker, and the reason is given", async () => {
    await startsIdle();

    await expect(proposesHolders(["plans", CARETAKER])).rejects.toMatchObject({
      reasons: ["The Caretaker is built in and holds no duty, so not Plans."],
    });
  });
});

/** The Caretaker drafts the set-up of The Office with `input`, then ends their turn. */
function setsUp(input: Record<string, unknown>): SessionScript {
  return calls(PROPOSE_OFFICE_SETUP_TOOL, input);
}

// A preset's Role has the preset's fixed key, which only roles.controller.test may hire into
// (apps/service/docs/testing.md): here the set-up hires a Role of each test's own from scratch, and
// People's office-setup tests hire the presets on Roles kept in memory.
describe("a Proposal of the set-up of The Office", () => {
  it("is drafted by the Caretaker, each duty from its holder now, changing nothing", async () => {
    const card = aProposedCard({ name: "Tess", title });
    await startWith(setsUp({ hires: [{ card }], duties: [{ duty: "reviews", holder: roleKey }] }));

    const { drafted } = await ask(CARETAKER, "Set The Office up for testing.");

    expect(toolResultRead().isError).toBe(false);
    expect(drafted).toEqual([
      expect.objectContaining({
        draftedBy: CARETAKER,
        change: {
          kind: "office-setup",
          hires: [{ kind: "hire", card, skills: [] }],
          duties: [{ duty: "reviews", from: "reviewer", to: roleKey }],
          hiredKeys: undefined,
        },
      }),
    ]);
    await expect(roles.read(roleKey)).rejects.toBeInstanceOf(RoleNotFound);
    expect(await holdersOf("reviews")).toEqual({ reviews: "reviewer" });
  });

  it("hires everyone and assigns the duties when the user applies it, as proposed by the Caretaker", async () => {
    await startWith(
      setsUp({
        hires: [{ card: aProposedCard({ name: "Tess", title }) }],
        duties: [{ duty: "reviews", holder: roleKey }],
      }),
    );
    const { drafted } = await ask(CARETAKER, "Set The Office up for testing.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");

    const applied = await proposals.apply(proposal.id, ANN_LEE);

    expect(applied).toMatchObject({
      change: { kind: "office-setup", hiredKeys: [roleKey] },
      status: { kind: "applied" },
    });
    const history = await roles.history(roleKey);
    expect(history.find((entry) => entry.kind === "hired")).toMatchObject({
      proposedBy: CARETAKER,
      savedBy: ANN_LEE,
    });
    expect(await holdersOf("reviews")).toEqual({ reviews: roleKey });
  });

  it("is refused once a duty it names changed since, hiring nobody and staying open", async () => {
    await startWith(
      setsUp({
        hires: [{ card: aProposedCard({ name: "Tess", title }) }],
        duties: [{ duty: "reviews", holder: roleKey }],
      }),
    );
    const { drafted } = await ask(CARETAKER, "Set The Office up for testing.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");
    await duties.change("reviews", null);

    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toThrow(
      "Reviews was changed meanwhile, so this change no longer applies.",
    );

    await expect(roles.read(roleKey)).rejects.toBeInstanceOf(RoleNotFound);
    expect((await proposals.read(proposal.id)).status).toEqual({ kind: "open" });
  });

  it("is not drafted for a duty naming the Caretaker or a Role nobody hires, and the Agent reads why", async () => {
    await startWith(
      setsUp({
        hires: [],
        duties: [
          { duty: "plans", holder: CARETAKER },
          { duty: "reviews", holder: roleKey },
        ],
      }),
    );

    const { drafted } = await ask(CARETAKER, "Let the Caretaker plan.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: expect.stringContaining("The Caretaker is built in and holds no duty, so not Plans."),
      isError: true,
    });
    expect(toolResultRead().text).toContain(
      `Reviews goes to a hired Role, and nobody is hired as "${roleKey}".`,
    );
  });
});

/** A Task's title, which the stand-in action below changes, with who changed it. */
class TaskTitleStandIn {
  title = "Old title";
  state = "ready";
  readonly applied: { title: string; user: string; proposedBy: string }[] = [];

  tool(): OfficeTool {
    return {
      name: "change_task_title",
      area: "work",
      description: "Changes a Task's title.",
      input: z.object({ taskId: z.string(), title: z.string() }),
      authority: {
        group: "taskRecords",
        title: "Change a Task's title",
        subject: (input) => ({ kind: "task", id: (input as { taskId: string }).taskId }),
      },
      run: () => Promise.resolve({ text: "Done.", isError: false }),
      draft: (input) => {
        const { taskId, title: newTitle } = input as { taskId: string; title: string };
        return Promise.resolve({
          subject: { kind: "task", id: taskId, title: this.title },
          fields: [{ label: "Title", before: this.title, after: newTitle, form: "short" as const }],
          fingerprint: { state: this.state, title: this.title },
        });
      },
      applyFor: (input, { user, proposedBy }) => {
        this.title = (input as { title: string }).title;
        this.applied.push({ title: this.title, user: user.name, proposedBy });
        return Promise.resolve({ text: "Done.", isError: false });
      },
    };
  }
}

/**
 * The Office actions of the library, ruled Proposal for the Roles that hold them there, which no
 * module of this app registers: stand-ins with the group the contracts declare for each. The skills'
 * `write_skill` is the real one, below.
 */
const LIBRARY_ACTIONS = [
  "add_library_pipeline",
  "create_project_pipeline",
  "save_prompt_template",
  "add_stage_template",
] as const;

describe("a Proposal of a library Office action", () => {
  it.each(LIBRARY_ACTIONS)(
    "drafts %s as an office-action Proposal that changes nothing until the user applies it, as that user",
    async (action) => {
      await startWith([{ step: "start", brief: { id: "brief", text: "" } }, ...endsTurn("Hi.")]);
      const { thread } = await ask(OFFICE_MANAGER, "Hello.");
      if (!thread.session) throw new Error("No session.");
      const declared = OFFICE_ACTIONS.find(({ name }) => name === action);
      if (!declared) throw new Error(`${action} is no Office action.`);
      const applied: { user: string; proposedBy: string }[] = [];
      const input = { name: "release-notes" };
      app.get(OfficeToolRegistry).register({
        name: action,
        area: CORE_AREA,
        description: declared.description,
        input: z.object({ name: z.string() }),
        authority: {
          group: declared.group,
          title: declared.title,
          subject: () => ({ kind: "library", id: "release-notes" }),
        },
        run: () => Promise.resolve({ text: "Done.", isError: false }),
        draft: () =>
          Promise.resolve({
            subject: { kind: "library", id: "release-notes", title: "release-notes" },
            fields: [{ label: "Name", before: "", after: "release-notes", form: "short" as const }],
            fingerprint: { name: "release-notes" },
          }),
        applyFor: (_input, { user, proposedBy }) => {
          applied.push({ user: user.name, proposedBy });
          return Promise.resolve({ text: "Done.", isError: false });
        },
      });
      const drafted = await app.get(OfficeToolRegistry).draft(action, input);
      if (!drafted) throw new Error("Nothing to draft.");

      const proposal = await proposals.draft(thread.session.id, {
        kind: "office-action",
        action,
        title: declared.title,
        input,
        ...drafted,
        outOfDate: false,
      });

      expect(proposal.change).toMatchObject({ kind: "office-action", action, outOfDate: false });
      expect(applied).toEqual([]);
      await proposals.apply(proposal.id, ANN_LEE);
      expect(applied).toEqual([{ user: ANN_LEE.name, proposedBy: OFFICE_MANAGER }]);
    },
  );

  it("drafts write_skill, the skills module's own action, and applies it as the user: the skill arrives off, for review", async () => {
    await startWith([{ step: "start", brief: { id: "brief", text: "" } }, ...endsTurn("Hi.")]);
    const { thread } = await ask(OFFICE_MANAGER, "Hello.");
    if (!thread.session) throw new Error("No session.");
    const name = `drafted-${randomUUID().slice(0, 8)}`;
    const input = { name, description: "Writes the release notes.", instructions: "List them." };
    const drafted = await app.get(OfficeToolRegistry).draft("write_skill", input);
    if (!drafted) throw new Error("Nothing to draft.");

    const proposal = await proposals.draft(thread.session.id, {
      kind: "office-action",
      action: "write_skill",
      title: "Write a skill",
      input,
      ...drafted,
      outOfDate: false,
    });

    expect(proposal.change).toMatchObject({ kind: "office-action", action: "write_skill" });
    await expect(app.get(SkillLibrary).read(name)).rejects.toThrow(name);
    await proposals.apply(proposal.id, ANN_LEE);
    expect(await app.get(SkillLibrary).read(name)).toMatchObject({
      name,
      state: "waiting-for-review",
    });
  });
});

describe("a Proposal of an Office action", () => {
  let task: TaskTitleStandIn;
  let sessionId: string;

  /** The Office Manager's session, and a Proposal of the title change drafted in it. */
  async function draftsTitle(taskId: string, newTitle: string): Promise<Proposal> {
    const input = { taskId, title: newTitle };
    const drafted = await app.get(OfficeToolRegistry).draft("change_task_title", input);
    if (!drafted) throw new Error("Nothing to draft.");
    return proposals.draft(sessionId, {
      kind: "office-action",
      action: "change_task_title",
      title: "Change a Task's title",
      input,
      ...drafted,
      outOfDate: false,
    });
  }

  beforeEach(async () => {
    await startWith([{ step: "start", brief: { id: "brief", text: "" } }, ...endsTurn("Hi.")]);
    const { thread } = await ask(OFFICE_MANAGER, "Hello.");
    if (!thread.session) throw new Error("No session.");
    sessionId = thread.session.id;
    task = new TaskTitleStandIn();
    app.get(OfficeToolRegistry).register(task.tool());
  });

  it("keeps the subject, the fields before and after and a fingerprint, and changes nothing", async () => {
    const proposal = await draftsTitle("task-1", "New title");

    expect(proposal.change).toMatchObject({
      kind: "office-action",
      action: "change_task_title",
      subject: { kind: "task", id: "task-1", title: "Old title" },
      fields: [{ label: "Title", before: "Old title", after: "New title", form: "short" }],
      outOfDate: false,
    });
    expect(task.applied).toEqual([]);
  });

  it("runs the action as the user who applies it, saying who proposed it", async () => {
    const proposal = await draftsTitle("task-1", "New title");

    await proposals.apply(proposal.id, ANN_LEE);

    expect(task.applied).toEqual([
      { title: "New title", user: ANN_LEE.name, proposedBy: OFFICE_MANAGER },
    ]);
    expect((await proposals.read(proposal.id)).status.kind).toBe("applied");
  });

  it("is refused once a field its handler reads changed, and then reads Out of date", async () => {
    const proposal = await draftsTitle("task-1", "New title");
    task.state = "running";

    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toThrow(
      '"Old title" changed since Marta drafted this. Ask them to draft it again.',
    );

    const read = await proposals.read(proposal.id);
    expect(read.status).toEqual({ kind: "open" });
    expect(read.change).toMatchObject({ kind: "office-action", outOfDate: true });
    expect(task.applied).toEqual([]);
  });

  describe("whose input holds a Secret value", () => {
    const SECRET = "agent-typed-secret";
    const NAME = "change_task_token";

    /** Drafts a call of a stand-in tool that reports the token as a Secret value. */
    async function draftsToken(): Promise<Proposal> {
      app.get(OfficeToolRegistry).register({
        ...task.tool(),
        name: NAME,
        input: z.object({ taskId: z.string(), title: z.string(), token: z.string() }),
        redact: (input) =>
          Promise.resolve({ shown: { ...input, token: "" }, hasSecret: input.token !== "" }),
      });
      const input = { taskId: "task-1", title: "New title", token: SECRET };
      const drafted = await app.get(OfficeToolRegistry).draft(NAME, input);
      if (!drafted) throw new Error("Nothing to draft.");
      return proposals.draft(sessionId, {
        kind: "office-action",
        action: NAME,
        title: "Change a token",
        input,
        editedInput: { ...input, title: "Edited title" },
        ...drafted,
        outOfDate: false,
      });
    }

    it("keeps it out of the stored Proposal once it is applied", async () => {
      const proposal = await draftsToken();

      await proposals.apply(proposal.id, ANN_LEE);

      const stored = await proposals.read(proposal.id);
      expect(stored.status.kind).toBe("applied");
      expect(JSON.stringify(stored)).not.toContain(SECRET);
    });

    it("keeps it out of the stored Proposal once it is declined", async () => {
      const proposal = await draftsToken();

      await proposals.decline(proposal.id, ANN_LEE);

      const stored = await proposals.read(proposal.id);
      expect(stored.status.kind).toBe("declined");
      expect(JSON.stringify(stored)).not.toContain(SECRET);
    });
  });

  it("declines an older open Proposal on the same subject once a newer one is applied", async () => {
    const older = await draftsTitle("task-1", "First");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await draftsTitle("task-1", "Second");

    await proposals.apply(newer.id, ANN_LEE);

    expect((await proposals.read(older.id)).status).toMatchObject({
      kind: "declined",
      because: { kind: "superseded", proposalId: newer.id },
    });
  });
});

/** An open Proposal as `propose_office_setting`, now retired, drafted it: it applies as before. */
async function draftsLimit(to: number): Promise<Proposal> {
  await startsIdle();
  return draftsRole({ kind: "office-wide-limit", from: 3, to });
}
