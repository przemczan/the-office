import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  proposalSchema,
  threadRefusalSchema,
  type Proposal,
} from "@the-office/contracts";
import { vi } from "vitest";
import type { ScriptedEngine, SessionScript } from "../../../engine/index.js";
import { DEVOPS, type RoleCards, type SessionRole } from "../../../people/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import { aPlannerCard } from "../../application/session-role.fixtures.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { ThreadService } from "../../application/thread-service.js";

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

/** The tools read a Source with several git calls, slow under a full run. */
const TOOL_ANSWER_TIMEOUT_MS = 25_000;

// Devops is hired from a preset under its fixed key, which only roles.controller.test may hire into
// (apps/service/docs/testing.md): People's RoleCards stand in for Nina here.
const NINA: SessionRole = {
  roleKey: DEVOPS,
  cardVersion: 1,
  card: aPlannerCard({ name: "Nina", title: "Devops" }),
};

/** People's Role cards with Nina alone hired, as Devops. */
export const NINA_ROLE_CARDS: Partial<RoleCards> = {
  find: (key) => Promise.resolve(key === DEVOPS ? NINA : undefined),
  forNewSession: () => Promise.resolve(NINA),
  forResumedSession: () => Promise.resolve(NINA),
  hiredKeys: () => Promise.resolve(new Set([DEVOPS])),
  consultants: () => Promise.resolve([]),
  findLetGo: () => Promise.resolve(undefined),
};

/** A skill name of the test's own, since every test file shares the database. */
export function aSkillName(): string {
  return `installed-${randomUUID().slice(0, 8)}`;
}

/**
 * Nina's chat in a whole app on the scripted engine, and the app's HTTP API. `engine` is the
 * test's own: a session that opens late, after its test timed out, would otherwise take the next
 * test's script off the shared queue and show up among its sessions.
 */
export class DevopsChat {
  constructor(
    private readonly app: INestApplication,
    private readonly url: string,
    private readonly engine: ScriptedEngine,
  ) {}

  /** What Nina read back from one Office tool she called in her chat. */
  async ninaCalls(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ readonly text: string; readonly isError: boolean }> {
    const sessionsBefore = this.engine.sessions.length;
    this.engine.queue([
      { step: "start", brief: { id: "brief", text: "" } },
      ...toolCall("c-0", tool, input),
      ...endsTurn("Done."),
    ]);
    const threadId = await this.askNina("Look at this source, please.");
    const answered = await vi
      .waitFor(
        () => {
          const result = this.reportedSince(sessionsBefore).find(
            (event) => event.kind === "tool-result",
          );
          if (!result) throw new Error("No Office tool answered yet.");
          return result;
        },
        { timeout: TOOL_ANSWER_TIMEOUT_MS, interval: 20 },
      )
      .catch(async (error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ${await this.whatTheThreadShows(threadId, sessionsBefore)}`,
        );
      });
    return { text: answered.text, isError: answered.isError };
  }

  /** Nina, asked in her chat, calls each Office tool with its input in one turn. */
  async ninaProposes(
    ...calls: readonly (readonly [string, Record<string, unknown>])[]
  ): Promise<readonly Proposal[]> {
    const sessionsBefore = this.engine.sessions.length;
    this.engine.queue([
      { step: "start", brief: { id: "brief", text: "" } },
      ...calls.flatMap(([tool, input], index) => toolCall(`c-${index}`, tool, input)),
      ...endsTurn("Here are the cards."),
    ]);
    const threadId = await this.askNina("Tidy up the commands, please.");
    const proposals = this.app.get(ProposalService, { strict: false });
    // The scripted turn may end before its Office tools finish drafting.
    const drafted = await vi.waitFor(
      async () => {
        const inThread = await proposals.listInThread(threadId);
        if (inThread.length >= calls.length) return inThread;
        // A refused draft never arrives: name the refusal rather than wait it out as slowness.
        const refusal = this.reportedSince(sessionsBefore).find(
          (event) => event.kind === "tool-result" && event.isError,
        );
        throw new Error(refusal?.kind === "tool-result" ? refusal.text : "Still drafting.");
      },
      { timeout: TOOL_ANSWER_TIMEOUT_MS, interval: 20 },
    );
    const stored = await Promise.all(drafted.map(({ id }) => this.readProposal(id)));
    // In the order of the calls, whatever order the tools finished in.
    return calls.map(([tool]) => {
      const proposal = stored.find(({ change }) => change.kind === KIND_OF_TOOL[tool]);
      if (!proposal) throw new Error(`${tool} drafted nothing.`);
      return proposal;
    });
  }

  async readProposal(id: string): Promise<Proposal> {
    return proposalSchema.parse(await this.read(`/proposals/${id}`));
  }

  /** The reasons of a refusal; throws for any other answer. */
  async reasonsOf(response: Response): Promise<readonly string[]> {
    await expectStatus(response, 422);
    return threadRefusalSchema.parse(await response.json()).reasons;
  }

  async read(path: string): Promise<unknown> {
    const response = await fetch(`${this.url}/api${path}`);
    await expectStatus(response, 200);
    return response.json();
  }

  api(method: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${this.url}/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** A new chat Thread with Nina, sent `message`; its id. */
  private async askNina(message: string): Promise<string> {
    const started = await this.app.get(ThreadService, { strict: false }).startInChat(DEVOPS);
    await this.app.get(ThreadRunner, { strict: false }).send(started.id, message);
    return started.id;
  }

  private reportedSince(sessionsBefore: number) {
    return this.engine.sessions.slice(sessionsBefore).flatMap((session) => session.reportedEvents);
  }

  /**
   * What a Thread no tool answered in shows: a failure before its session ran is logged only to
   * the Thread (test apps log nothing), and looks like a stall otherwise.
   */
  private async whatTheThreadShows(threadId: string, sessionsBefore: number): Promise<string> {
    const threads = this.app.get(ThreadService, { strict: false });
    const { state } = await threads.read(threadId);
    const messages = (await threads.messages(threadId)).map((message) =>
      message.kind === "failure" ? `failure: ${message.reason}` : message.kind,
    );
    const sessions = this.engine.sessions
      .slice(sessionsBefore)
      .map((session) => session.reportedEvents.map((event) => event.kind));
    return `The Thread is ${state}; its messages: ${JSON.stringify(messages)}; its sessions' events: ${JSON.stringify(sessions)}.`;
  }
}

/** Throws, with the body, unless the response has the expected status. */
async function expectStatus(response: Response, status: number): Promise<void> {
  if (response.status === status) return;
  throw new Error(
    `${response.url} answered ${response.status}, not ${status}: ${await response.text()}`,
  );
}

const KIND_OF_TOOL: Readonly<Record<string, Proposal["change"]["kind"]>> = {
  [PROPOSE_PROJECT_COMMANDS_TOOL]: "project-commands",
  [PROPOSE_LIBRARY_PIPELINE_TOOL]: "pipeline",
  [PROPOSE_STAGE_TEMPLATE_TOOL]: "stage-template",
  [PROPOSE_PROJECT_TOOL]: "project",
  [PROPOSE_SKILL_INSTALL_TOOL]: "skill-install",
  [PROPOSE_SKILL_UPDATE_TOOL]: "skill-update",
  [PROPOSE_SKILL_TOOL]: "skill",
};

function toolCall(callId: string, tool: string, input: Record<string, unknown>): Step[] {
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
