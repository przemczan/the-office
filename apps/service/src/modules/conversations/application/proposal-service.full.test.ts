import { OFFICE_INSTRUCTIONS_MAX_CHARACTERS } from "@the-office/contracts";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  CARETAKER,
  OFFICE_MANAGER,
  Duties,
  EngineCascade,
  PeopleModule,
  RoleCards,
  RoleNotFound,
  RoleService,
  type SessionRole,
} from "../../people/index.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../domain/context-policy.js";
import { OfficeInstructionsChanged } from "../domain/conversation-events.js";
import { aProposedCard } from "../domain/proposal.fixtures.js";
import {
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_OFFICE_SETUP_TOOL,
  PROPOSE_ROLE_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
  READ_ROLE_TOOL,
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
import {
  DutyRepository,
  DutyRepositoryForTests,
  EngineCascadeStandIn,
  OfficeSetupRepository,
  OfficeSetupRepositoryForTests,
  RoleRepository,
} from "../../people/index.fixtures.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { ProposalOfficeTools } from "../adapters/office-tools/proposal-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { DutyProposals } from "../adapters/proposals/duty-proposals.js";
import { OfficeInstructionsProposals } from "../adapters/proposals/office-instructions-proposals.js";
import { SizeThresholdProposals } from "../adapters/proposals/size-threshold-proposals.js";
import type { Proposal, ProposedSettingChange } from "../domain/proposal.js";
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
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import { ANN_LEE, BEN_ITO } from "../domain/user.fixtures.js";

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

// The Caretaker's card, as People's RoleCards stand in for it too.
const CARETAKER_ROLE: SessionRole = {
  roleKey: CARETAKER,
  cardVersion: 1,
  mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
  card: aPlannerCard({ name: "Sam", title: "Caretaker" }),
};

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
      EventsModule,
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
      { provide: EngineCascade, useValue: new EngineCascadeStandIn() },
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
      ProposalAppliers,
      ProposalService,
      RoleProposals,
      SizeThresholdProposals,
      OfficeInstructionsProposals,
      DutyProposals,
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
    // Every test file shares the stored duties, which decide who other files' sessions consult.
    overrides: [
      { provide: RoleCards, useValue: roleCards },
      { provide: DutyRepository, useValue: new DutyRepositoryForTests() },
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
  PROPOSE_OFFICE_SETUP_TOOL,
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
      const names = new Set([...chatOfficeTools(OFFICE_MANAGER), ...chatOfficeTools(CARETAKER)]);
      for (const name of names) {
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
    await startWith(proposes({ card }));
    const { drafted } = await askOfficeManager("We need a tester.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");

    await expect(
      proposals.apply(proposal.id, ANN_LEE, {
        kind: "hire",
        card: { ...card, name: "" },
        skills: [],
      }),
    ).rejects.toThrow("Give the person a name.");

    expect((await proposals.read(proposal.id)).status).toEqual({ kind: "open" });
  });

  it("is not drafted on a card People would refuse, and the Agent reads why", async () => {
    await startWith(
      proposes({ card: aProposedCard({ title, responsibilities: "Tests.\n\nAnd more tests." }) }),
    );

    const { thread, drafted } = await askOfficeManager("We need a tester.");

    expect(drafted).toEqual([]);
    const log = await threads.messages(thread.id);
    expect(log.some(({ kind }) => kind === "proposal")).toBe(false);
    expect(toolResultRead()).toEqual({
      text: expect.stringContaining("one paragraph"),
      isError: true,
    });
  });
});

// A preset's Role has the preset's fixed key, which only roles.controller.test may hire into
// (apps/service/docs/testing.md): here People's preset hiring stands in, and its rules are
// role-changes.test's.
describe("a Proposal of a person in a preset's Role", () => {
  it("hires them, under the name the user gave, only when the user applies it", async () => {
    await startWith(proposes({ preset: "developer", card: { name: "Ada" } }));
    const presetHiringProblems = vi.spyOn(roles, "presetHiringProblems").mockResolvedValue([]);
    const hire = vi
      .spyOn(roles, "hire")
      .mockImplementation((key, name) =>
        Promise.resolve({ role: { key, card: { name: name.trim() } }, skills: [] } as never),
      );

    const proposal = await theOnlyProposal("We need a developer.");

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

  it("is not drafted when People would refuse the hire, and the Agent reads why", async () => {
    await startWith(proposes({ preset: "developer", card: { name: "Ada" } }));
    vi.spyOn(roles, "presetHiringProblems").mockResolvedValue([
      "Ada already fills the Developer Role.",
    ]);

    const { drafted } = await askOfficeManager("We need a developer.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: "Ada already fills the Developer Role.",
      isError: true,
    });
  });
});

describe("a Proposal of the size threshold", () => {
  const { sizeThreshold } = DEFAULT_CONTEXT_POLICY_SETTINGS;

  it("changes it, from the value it had, only when the user applies it", async () => {
    await startWith(
      calls(PROPOSE_OFFICE_SETTING_TOOL, { setting: "size-threshold", value: 60_000 }),
    );

    const proposal = await theOnlyProposal("Sessions restart too often.");

    expect(proposal.change).toEqual({ kind: "size-threshold", from: sizeThreshold, to: 60_000 });
    expect(toolResultRead().isError).toBe(false);
    expect(await settings.sizeThreshold()).toBe(sizeThreshold);

    await proposals.apply(proposal.id, ANN_LEE);

    expect(await settings.sizeThreshold()).toBe(60_000);
    expect((await proposals.read(proposal.id)).status).toMatchObject({ kind: "applied" });
  });

  it("changes nothing when the user declines it", async () => {
    await startWith(
      calls(PROPOSE_OFFICE_SETTING_TOOL, { setting: "size-threshold", value: 60_000 }),
    );
    const proposal = await theOnlyProposal("Sessions restart too often.");

    await proposals.decline(proposal.id, ANN_LEE);

    expect(await settings.sizeThreshold()).toBe(sizeThreshold);
  });

  it("is not drafted on a value Settings would refuse, and the Agent reads why", async () => {
    await startWith(
      calls(PROPOSE_OFFICE_SETTING_TOOL, { setting: "size-threshold", value: 1_234 }),
    );

    const { drafted } = await askOfficeManager("Sessions restart too often.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: "The size threshold is from 5000 to 200000 tokens, in steps of 5000.",
      isError: true,
    });
    expect(await settings.sizeThreshold()).toBe(sizeThreshold);
  });
});

describe("a Proposal of the Office-wide limit", () => {
  it("is applied by Work, from the limit it keeps, saying who proposed it", async () => {
    await startWith(calls(PROPOSE_OFFICE_SETTING_TOOL, { setting: "office-wide-limit", value: 5 }));

    const proposal = await theOnlyProposal("Let more Tasks run at once.");

    expect(proposal.change).toEqual({ kind: "office-wide-limit", from: 3, to: 5 });
    expect(officeWideLimit.applied).toEqual([]);

    await proposals.apply(proposal.id, ANN_LEE);

    expect(officeWideLimit.applied).toEqual([
      { change: { kind: "office-wide-limit", from: 3, to: 5 }, by: OFFICE_MANAGER },
    ]);
  });

  it("changes nothing when the user declines it", async () => {
    await startWith(calls(PROPOSE_OFFICE_SETTING_TOOL, { setting: "office-wide-limit", value: 5 }));
    const proposal = await theOnlyProposal("Let more Tasks run at once.");

    await proposals.decline(proposal.id, ANN_LEE);

    expect(officeWideLimit.limit).toBe(3);
    expect(officeWideLimit.applied).toEqual([]);
  });

  it("is not drafted when Work would refuse it, and the Agent reads why", async () => {
    await startWith(calls(PROPOSE_OFFICE_SETTING_TOOL, { setting: "office-wide-limit", value: 3 }));

    const { drafted } = await askOfficeManager("Let more Tasks run at once.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: "The Office-wide limit is 3 already.",
      isError: true,
    });
  });
});

describe("a Proposal of the Office instructions", () => {
  it("is drafted from the text now, and changes it only when the user applies it", async () => {
    const proposal = await draftOver("Write in plain words.", "  Keep it short.\n");

    expect(proposal.change).toEqual({
      kind: "office-instructions",
      from: "Write in plain words.",
      to: "Keep it short.",
    });
    expect(toolResultRead().isError).toBe(false);
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

  it("empties them when a text of spaces is applied", async () => {
    const proposal = await draftOver("Write in plain words.", "   ");

    await proposals.apply(proposal.id, ANN_LEE);

    expect(await officeInstructions.current()).toEqual({ version: 2, text: "" });
  });

  it("is not drafted on the text they are now, even with spaces around it", async () => {
    await startWith(drafts("  Write in plain words.  "));
    await officeInstructions.save("Write in plain words.", ANN_LEE);

    const { drafted } = await askOfficeManager("Ask for plain words.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: "The Office instructions are this text already.",
      isError: true,
    });
  });

  it("is not drafted over the limit, and the Agent reads why", async () => {
    await startWith(drafts("a".repeat(OFFICE_INSTRUCTIONS_MAX_CHARACTERS + 1)));

    const { drafted } = await askOfficeManager("Ask for plain words.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: `The Office instructions are at most ${OFFICE_INSTRUCTIONS_MAX_CHARACTERS} characters.`,
      isError: true,
    });
  });

  it("lets the Office Manager read the text now, newer than their session's", async () => {
    await startWith(calls(READ_OFFICE_INSTRUCTIONS_TOOL, {}));
    await officeInstructions.save("Write in plain words.", ANN_LEE);

    await askOfficeManager("What do the Office instructions say?");

    expect(toolResultRead()).toEqual({ text: "Write in plain words.", isError: false });
  });
});

describe("a Proposal of a change to a Role", () => {
  it("is drafted from the whole card the Office Manager reads first, instructions included", async () => {
    const instructions = "Work from the Plan.\n\nKeep the tests green.";
    const rewritten = `${instructions}\n\nEnd every Stage with a Handover note.`;
    await startWith([
      { step: "start", brief: { id: "brief", text: "" } },
      ...officeToolCall("c-1", READ_ROLE_TOOL, { role: roleKey }),
      ...officeToolCall("c-2", PROPOSE_ROLE_TOOL, {
        role: roleKey,
        card: { instructions: rewritten },
      }),
      ...endsTurn("Here is the card."),
    ]);
    await roles.hireFromScratch(aProposedCard({ title, instructions }), [], ANN_LEE);

    const proposal = await theOnlyProposal("Ask the tester for a Handover note.");

    const read = toolResultRead("c-1");
    expect(read.isError).toBe(false);
    expect(read.text).toContain(`(Role ${roleKey}), card version 1`);
    expect(read.text).toContain(`\n\ninstructions:\n${instructions}\n\n`);
    expect(proposal.change).toEqual({
      kind: "change",
      roleKey,
      from: { instructions },
      to: { instructions: rewritten },
    });
  });

  it("changes only the fields it names, when the user applies it, saying who proposed it and who applied it", async () => {
    await startWith(proposes({ role: roleKey, card: { effort: "high" } }));
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);

    const { drafted } = await askOfficeManager("Let the tester think harder.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");

    expect(proposal.change).toEqual({
      kind: "change",
      roleKey,
      from: { effort: "medium" },
      to: { effort: "high" },
    });
    expect((await roles.read(roleKey)).role.card.effort).toBe("medium");
    // The user renames the person meanwhile: applying keeps that.
    const { role: renamed, skills } = await roles.read(roleKey);
    await roles.changeCard(roleKey, { ...renamed.card, name: "Tom" }, skills, ANN_LEE);

    await proposals.apply(proposal.id, BEN_ITO);

    expect((await roles.read(roleKey)).role.card).toMatchObject({ name: "Tom", effort: "high" });
    const [latest, byTheUser] = await roles.history(roleKey);
    expect(latest).toMatchObject({
      kind: "card-changed",
      changes: [{ field: "effort", from: "medium", to: "high" }],
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
    await startWith(proposes({ role: roleKey, card: { effort: "high" } }));
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);
    const { drafted } = await askOfficeManager("Let the tester think harder.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");

    const declined = await proposals.decline(proposal.id, ANN_LEE);

    expect(declined.status).toMatchObject({ kind: "declined" });
    expect((await roles.read(roleKey)).role.cardVersion).toBe(1);
    await expect(proposals.apply(proposal.id, ANN_LEE)).rejects.toThrow(
      "This Proposal was declined.",
    );
  });
});

/** The Office Manager proposes the duties' new holders, each `[duty, holder]`. */
function proposesHolders(...holders: [string, string | null][]): SessionScript {
  return calls(PROPOSE_OFFICE_SETTING_TOOL, {
    setting: "duties",
    duties: holders.map(([duty, holder]) => ({ duty, holder })),
  });
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
  it("is drafted from the holders now of the duties it names, changing nothing", async () => {
    await startWith(proposesHolders(["plans", roleKey], ["reviews", null]));
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);

    const proposal = await theOnlyProposal("Let the tester plan.");

    expect(toolResultRead().isError).toBe(false);
    expect(proposal.change).toEqual({
      kind: "duties",
      from: { plans: "planner", reviews: "reviewer" },
      to: { plans: roleKey, reviews: null },
    });
    expect(await holdersOf("plans", "reviews")).toEqual({ plans: "planner", reviews: "reviewer" });
  });

  it("sets every duty it names when the user applies it", async () => {
    await startWith(proposesHolders(["plans", roleKey], ["shapes-initiatives", roleKey]));
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);
    const proposal = await theOnlyProposal("Let the tester plan and shape.");

    const applied = await proposals.apply(proposal.id, ANN_LEE);

    expect(applied.status).toMatchObject({ kind: "applied" });
    expect(await holdersOf("plans", "shapes-initiatives")).toEqual({
      plans: roleKey,
      "shapes-initiatives": roleKey,
    });
  });

  it("is refused once a duty it names changed since, and changes none of them", async () => {
    await startWith(proposesHolders(["plans", roleKey], ["shapes-initiatives", roleKey]));
    await roles.hireFromScratch(aProposedCard({ title }), [], ANN_LEE);
    const proposal = await theOnlyProposal("Let the tester plan and shape.");
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

  it("is not drafted for a Role nobody is hired as, and the Agent reads why", async () => {
    await startWith(proposesHolders(["plans", roleKey]));

    const { drafted } = await askOfficeManager("Let the tester plan.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: `Plans goes to a hired Role, and nobody is hired as "${roleKey}".`,
      isError: true,
    });
  });

  it("is not drafted for the Caretaker, and the Agent reads why", async () => {
    await startWith(proposesHolders(["plans", CARETAKER]));

    const { drafted } = await askOfficeManager("Let the Caretaker plan.");

    expect(drafted).toEqual([]);
    expect(toolResultRead()).toEqual({
      text: "The Caretaker is built in and holds no duty, so not Plans.",
      isError: true,
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
