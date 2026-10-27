import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactoryProvider, INestApplication } from "@nestjs/common";
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
import {
  PeopleModule,
  RoleCards,
  RoleNotFound,
  RoleService,
  type SessionRole,
} from "../../people/index.js";
import { SessionSkills } from "../../skills/index.js";
import { ProposalOfficeTools } from "../adapters/office-tools/proposal-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import type { Proposal } from "../domain/proposal.js";
import { aProposedCard } from "../domain/proposal.fixtures.js";
import {
  chatOfficeTools,
  OFFICE_MANAGER,
  PROPOSE_ROLE_TOOL,
} from "../domain/session-instructions.js";
import type { Thread } from "../domain/thread.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { MentionedRecords } from "./mentioned-records.js";
import { ProposalAppliers } from "./proposal-appliers.js";
import { ProposalService } from "./proposal-service.js";
import { RoleProposals } from "./role-proposals.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { StageThreads } from "./stage-threads.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { ThreadContexts } from "./thread-contexts.js";
import { ThreadRunner } from "./thread-runner.js";
import { ThreadService } from "./thread-service.js";
import { WorkRecords } from "./work-records.js";

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

// The Office Manager's chat is keyed by the preset's fixed key, which only roles.controller.test
// may hire into (apps/service/docs/testing.md): here People's RoleCards stand in for them, while
// the Roles they propose are hired and changed through the real People module, each test's own.
const OFFICE_MANAGER_ROLE: SessionRole = {
  roleKey: OFFICE_MANAGER,
  cardVersion: 1,
  card: aPlannerCard({ name: "Marta", title: "Office Manager" }),
};

let app: INestApplication;
let officeData: string;
let threads: ThreadService;
let runner: ThreadRunner;
let proposals: ProposalService;
let roles: RoleService;
/** A Role title of each test's own, so its Role key, which People makes from it, is too. */
let title: string;
let roleKey: string;

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

/** Boots the conversations and People on a scripted engine that replays `scripts`. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  const engine = new ScriptedEngine(scripts);
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
  const bases: ProjectBases = {
    folder: join(officeData, "bases"),
    list: () => Promise.resolve([]),
    refresh: () => Promise.resolve([]),
  };
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ScriptedEngineModule.register(engine),
      PeopleModule,
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: ProjectBases, useValue: bases },
      { provide: SessionSkills, useValue: sessionSkills },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      sessionMemoryProvider(),
      TaskThreadSetups,
      SessionPlaces,
      ThreadContexts,
      ThreadRunner,
      MentionedRecords,
      WorkRecords,
      StageThreads,
      ProposalAppliers,
      ProposalService,
      RoleProposals,
      ProposalOfficeTools,
      chatToolStandIns(),
    ],
    overrides: [{ provide: RoleCards, useValue: roleCards }],
  }));
  threads = app.get(ThreadService);
  runner = app.get(ThreadRunner);
  proposals = app.get(ProposalService);
  roles = app.get(RoleService);
}

/**
 * The chat tools that read records, as the Projects, People and Work modules register them, on the
 * registry the sessions read: People, booted here for its Roles, registers on an engine of its own.
 */
function chatToolStandIns(): FactoryProvider {
  return {
    provide: "chat tool stand-ins",
    inject: [OfficeToolRegistry],
    useFactory: (registry: OfficeToolRegistry) => {
      for (const name of chatOfficeTools(OFFICE_MANAGER)) {
        if (name === PROPOSE_ROLE_TOOL) continue;
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

/** The Office Manager proposes with `input`, then ends their turn. */
function proposes(input: Record<string, unknown>): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId: "c-1",
        tool: PROPOSE_ROLE_TOOL,
        officeTool: true,
        input,
        withinToolCall: undefined,
      },
    },
    { step: "event", event: { kind: "tool-result", callId: "c-1", text: "", isError: false } },
    ...endsTurn("Here is the card."),
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
  await runner.send(started.id, text);
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

    const applied = await proposals.apply(proposal.id, {
      card: { ...card, name: "Tom" },
      skills: [],
    });

    expect(applied).toMatchObject({
      change: { kind: "hire", card: { name: "Tom" }, roleKey },
      status: { kind: "applied" },
    });
    expect((await roles.read(roleKey)).role.card.name).toBe("Tom");
    expect(await roles.history(roleKey)).toEqual([
      { kind: "hired", at: expect.any(Date), proposedBy: OFFICE_MANAGER },
    ]);
    await expect(proposals.apply(proposal.id)).rejects.toThrow("This Proposal is applied already.");
  });

  it("stays open with People's reasons when hiring is refused", async () => {
    const card = aProposedCard({ title });
    await startWith(proposes({ card }));
    const { drafted } = await askOfficeManager("We need a tester.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");

    await expect(
      proposals.apply(proposal.id, { card: { ...card, name: "" }, skills: [] }),
    ).rejects.toThrow("Give the person a name.");

    expect((await proposals.read(proposal.id)).status).toEqual({ kind: "open" });
  });

  it("is not drafted on a card People would refuse, and the Agent reads why", async () => {
    await startWith(proposes({ card: aProposedCard({ title, model: "gpt-5" }) }));

    const { thread, drafted } = await askOfficeManager("We need a tester.");

    expect(drafted).toEqual([]);
    const log = await threads.messages(thread.id);
    expect(log.some(({ kind }) => kind === "proposal")).toBe(false);
  });
});

describe("a Proposal of a change to a Role", () => {
  it("changes only the fields it names, when the user applies it, saying who proposed it", async () => {
    await startWith(proposes({ role: roleKey, card: { effort: "high" } }));
    await roles.hireFromScratch(aProposedCard({ title }), []);

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
    await roles.changeCard(roleKey, { ...renamed.card, name: "Tom" }, skills);

    await proposals.apply(proposal.id);

    expect((await roles.read(roleKey)).role.card).toMatchObject({ name: "Tom", effort: "high" });
    const [latest, byTheUser] = await roles.history(roleKey);
    expect(latest).toMatchObject({
      kind: "card-changed",
      changes: [{ field: "effort", from: "medium", to: "high" }],
      proposedBy: OFFICE_MANAGER,
    });
    expect(byTheUser).toMatchObject({ kind: "card-changed", proposedBy: undefined });
  });

  it("changes nothing when the user declines it", async () => {
    await startWith(proposes({ role: roleKey, card: { effort: "high" } }));
    await roles.hireFromScratch(aProposedCard({ title }), []);
    const { drafted } = await askOfficeManager("Let the tester think harder.");
    const [proposal] = drafted;
    if (!proposal) throw new Error("No Proposal was drafted.");

    const declined = await proposals.decline(proposal.id);

    expect(declined.status).toMatchObject({ kind: "declined" });
    expect((await roles.read(roleKey)).role.cardVersion).toBe(1);
    await expect(proposals.apply(proposal.id)).rejects.toThrow("This Proposal was declined.");
  });
});
