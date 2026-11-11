import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Engine } from "../domain/engines.js";
import { AgentEngine, CapabilityMissing, type EngineCapabilities } from "./agent-engine.js";
import type { EngineSession, UserMessage } from "./engine-session.js";
import type { OfficeTool, OfficeToolCall } from "./office-tool.js";
import type {
  ProcessEndedEvent,
  ProcessStartedEvent,
  SessionEvent,
  ToolCallEvent,
  ToolRefusedEvent,
  TurnEndedEvent,
} from "./session-events.js";
import type {
  ApprovalCall,
  SessionMcpServer,
  SessionMcpServerLaunch,
  SessionOptions,
} from "./session-options.js";

/**
 * What every adapter of `AgentEngine` does, as tests each adapter runs against itself. Each
 * scenario has a name, which a scripted engine replays the recording of. A scenario asserts only
 * the shape of what happened, never the model's words, so it holds for a live engine too.
 */
export const CONTRACT_SCENARIOS = [
  "reply",
  "office-tool",
  "refusal",
  "barge-in",
  "later",
  "interrupt",
  "resume",
  "output-schema",
  "usage-windows",
  "context-usage",
  "mcp-tool",
  "background",
  "background-stop",
] as const;

export type ContractScenario = (typeof CONTRACT_SCENARIOS)[number];

export interface EngineUnderContract {
  /** What the adapter declares; scenarios for a missing capability check its refusal instead. */
  readonly capabilities: EngineCapabilities;
  /** The engine Settings › Engines would list that sessions run on. */
  readonly engine: Engine;
  /** The model sessions run on: the cheapest that follows the briefs. */
  readonly model: string;
  /** How long one scenario may take. */
  readonly timeoutMs: number;
  /** The engine for one scenario; called once per scenario, before its sessions start. */
  engineFor(scenario: ContractScenario): Promise<AgentEngine>;
  /** Called once a scenario's sessions have ended, as a recording engine saves them. */
  afterScenario?(scenario: ContractScenario, engine: AgentEngine): Promise<void>;
  /** The fake local MCP server `mcp-tool` runs on; undefined skips it, for an engine without them yet. */
  readonly mcpServer?: ContractMcpServer;
}

/** The platform's fake local MCP server, which the ports layer can't reach itself. */
export interface ContractMcpServer {
  /** Its launch in `folder`, with `variables` set: its tools are echo, environment-variable and started-process. */
  launch(variables: Readonly<Record<string, string>>, folder: string): SessionMcpServerLaunch;
  /** Whether a process runs, to see the process the server started end with the session. */
  isRunning(processId: number): boolean;
}

type ScenarioRun = (engine: AgentEngine, options: SessionOptions) => Promise<void>;

export function describeAgentEngineContract(adapter: string, under: EngineUnderContract): void {
  const can = under.capabilities;

  describe(`${adapter} keeps the AgentEngine contract`, () => {
    let folder: string;

    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "office-engine-"));
    });

    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    /** Runs one scenario against a fresh engine, then lets the adapter's test keep what it ran. */
    const scenario =
      (name: ContractScenario, run: ScenarioRun): (() => Promise<void>) =>
      async () => {
        const engine = await under.engineFor(name);
        expect(engine.capabilities).toEqual(under.capabilities);
        await run(engine, defaultOptions(folder, under));
        await under.afterScenario?.(name, engine);
      };

    it(
      "starts a session on its brief, reports a turn that took it with its tokens, and ends",
      scenario("reply", async (engine, options) => {
        const brief = message("Reply with the single word: ready");
        const session = await engine.start({ id: randomUUID(), options, brief });
        const log = new EventLog(session);

        const turn = await log.nextTurn();
        expect(turn.outcome).toBe("completed");
        expect(turn.consumedMessageIds).toEqual([brief.id]);
        expect(log.events.some((event) => event.kind === "text")).toBe(true);
        expect(turn.usage.output).toBeGreaterThan(0);
        expect(turn.usage.input + turn.usage.cacheRead + turn.usage.cacheCreation).toBeGreaterThan(
          0,
        );
        expect(turn.sessionCostUsd).toBeGreaterThanOrEqual(0);
        await session.end();
        await log.finished;
      }),
      under.timeoutMs,
    );

    it.runIf(can.officeTools)(
      "runs an Office tool the Agent calls, and the Agent reads what it answers",
      scenario("office-tool", async (engine, options) => {
        const notes = noteTool();
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [notes.tool] },
          brief: message(
            `Call the ${notes.tool.name} tool once with the word "tangerine", then reply with the single word: done`,
          ),
        });
        const log = new EventLog(session);

        expect((await log.nextTurn()).outcome).toBe("completed");
        const call = log.officeToolCall(notes.tool.name);
        expect(call.input).toEqual({ word: "tangerine" });
        expect(notes.calls).toEqual([{ input: { word: "tangerine" }, sessionId: session.id }]);
        expect(log.resultOf(call)).toMatchObject({ text: NOTED, isError: false });
        await expectCommandsJudgedAsTheSessionsShell(notes.judges[0]);
        await session.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.officeTools)(
      "refuses a session with Office tools without the officeTools capability",
      scenario("office-tool", async (engine, options) => {
        const start = engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [noteTool().tool] },
          brief: message("Reply with the single word: ready"),
        });
        await expect(start).rejects.toEqual(new CapabilityMissing("officeTools"));
      }),
      under.timeoutMs,
    );

    it(
      "refuses a call the session's profile doesn't allow, and the Agent reads why",
      scenario("refusal", async (engine, options) => {
        const session = await engine.start({
          id: randomUUID(),
          options,
          brief: message(
            "Create the file notes.txt containing the word hi, with your tool for writing files. " +
              "If that is refused, do not try again or another way; reply with the single word: refused",
          ),
        });
        const log = new EventLog(session);

        expect((await log.nextTurn()).outcome).toBe("completed");
        const refusal = log.refusal();
        expect(refusal).toMatchObject({ refusedBy: "office-rules", reason: EDIT_REFUSAL });
        expect(log.resultOf(log.call(refusal.callId))).toMatchObject({
          isError: true,
          text: expect.stringContaining(EDIT_REFUSAL),
        });
        expect(existsSync(join(options.folder, "notes.txt"))).toBe(false);
        await session.end();
      }),
      under.timeoutMs,
    );

    const mcpServer = under.mcpServer;
    it.runIf(mcpServer)(
      "runs the session's MCP server as each tool's setting says, and ends it with the session",
      scenario("mcp-tool", async (engine, options) => {
        if (mcpServer === undefined) return;
        const approvals: ApprovalCall[] = [];
        const session = await engine.start({
          id: randomUUID(),
          options: {
            ...options,
            profile: { ...options.profile, mcpTools: FAKE_TOOL_SETTINGS },
            mcpServers: [fakeServer(mcpServer, options.folder)],
            approvalHold: (call) => {
              approvals.push(call);
              return Promise.resolve(undefined);
            },
          },
          brief: message(
            `Use the tools of the ${FAKE_SERVER} MCP server, each once, in this order: ` +
              `environment-variable with the name ${SERVER_VALUE_NAME}, started-process, and echo ` +
              "with the text hi. If a call is refused, do not try it again; then reply with the " +
              "single word: done",
          ),
        });
        const log = new EventLog(session);

        expect((await log.nextTurn()).outcome).toBe("completed");
        expect(log.resultOf(log.toolCall(mcpToolName("environment-variable")))).toMatchObject({
          text: SERVER_VALUE,
          isError: false,
        });
        expect(approvals).toMatchObject([
          { server: FAKE_SERVER, tool: "started-process", setting: CONSULT_DEVOPS },
        ]);
        const started = log.resultOf(log.toolCall(mcpToolName("started-process")));
        expect(started).toMatchObject({ text: expect.stringMatching(/^\d+$/), isError: false });
        const echo = log.toolCall(mcpToolName("echo"));
        expect(log.refusal()).toMatchObject({
          callId: echo.callId,
          refusedBy: "office-rules",
          reason: `Not allowed in this session: the ${FAKE_SERVER}/echo MCP tool.`,
        });
        await session.end();
        const startedProcess = Number(started?.kind === "tool-result" ? started.text : "");
        await vi.waitFor(() => expect(mcpServer.isRunning(startedProcess)).toBe(false), {
          timeout: 10_000,
        });
      }),
      under.timeoutMs,
    );

    it(
      "reports a background command's start, its output in order and whole, and its end, between turns too",
      scenario("background", async (engine, options) => {
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, profile: RUNS_ANYTHING },
          brief: message(
            `Run this command with your Bash tool in the background (run_in_background: true): ${COUNTING_COMMAND}\n` +
              "Don't read its output and don't wait for it; reply with the single word: started",
          ),
        });
        const log = new EventLog(session);

        expect((await log.nextTurn()).outcome).toBe("completed");
        const ended = await log.processEnded();
        const started = log.processStarted();
        expect(started.callId).toBe(log.toolCall("Bash").callId);
        expect(started.commandLine).toContain("line ");
        expect(started.engineTaskId).not.toBe("");
        expect(ended).toMatchObject({ callId: started.callId, ending: { state: "finished" } });
        expect(log.outputOf(started.callId).replaceAll("\r\n", "\n")).toBe(
          "line 1\nline 2\nline 3\n",
        );
        expect(log.events.indexOf(started)).toBeLessThan(log.events.indexOf(ended));
        await session.end();
      }),
      under.timeoutMs,
    );

    it(
      "reports a background command the Agent stops with TaskStop as stopped by the Agent",
      scenario("background-stop", async (engine, options) => {
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, profile: RUNS_ANYTHING },
          brief: message(
            `Run this command with your Bash tool in the background (run_in_background: true): ${TICKING_COMMAND}\n` +
              "Then stop it at once with your TaskStop tool, and reply with the single word: stopped",
          ),
        });
        const log = new EventLog(session);

        const ended = await log.processEnded();
        expect(ended).toMatchObject({
          callId: log.processStarted().callId,
          ending: { state: "stopped", by: "agent" },
        });
        await session.end();
      }),
      under.timeoutMs,
    );

    it.runIf(can.bargeIn && can.officeTools)(
      "lands a message sent with priority next in the running turn, between tool calls",
      scenario("barge-in", async (engine, options) => {
        const hold = holdTool();
        const brief = message(holdBrief(hold.tool));
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [hold.tool] },
          brief,
        });
        const log = new EventLog(session);

        await hold.called;
        const bargeIn = message("Also reply with the single word: extra");
        session.send(bargeIn, "next");
        hold.release();

        expect((await log.nextTurn()).consumedMessageIds).toEqual([brief.id, bargeIn.id]);
        await session.end();
      }),
      under.timeoutMs,
    );

    it.runIf(can.officeTools)(
      "holds a message sent with priority later until the turn ends, then starts a turn on it",
      scenario("later", async (engine, options) => {
        const hold = holdTool();
        const brief = message(holdBrief(hold.tool));
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [hold.tool] },
          brief,
        });
        const log = new EventLog(session);

        await hold.called;
        const later = message("Reply with the single word: later");
        session.send(later, "later");
        hold.release();

        expect((await log.nextTurn()).consumedMessageIds).toEqual([brief.id]);
        const next = await log.nextTurn();
        expect(next.consumedMessageIds).toEqual([later.id]);
        expect(next.outcome).toBe("completed");
        await session.end();
      }),
      under.timeoutMs,
    );

    it.runIf(can.interrupt && can.officeTools)(
      "stops the running turn on interrupt, and the session takes the next message",
      scenario("interrupt", async (engine, options) => {
        const hold = holdTool();
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [hold.tool] },
          brief: message(holdBrief(hold.tool)),
        });
        const log = new EventLog(session);

        await hold.called;
        await session.interrupt();
        expect((await log.nextTurn()).outcome).toBe("interrupted");
        hold.release();

        const after = message("Reply with the single word: back");
        session.send(after, "next");
        const next = await log.nextTurn();
        expect(next.outcome).toBe("completed");
        expect(next.consumedMessageIds).toEqual([after.id]);
        await session.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.interrupt)(
      "refuses to interrupt without the interrupt capability",
      scenario("reply", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          await expect(session.interrupt()).rejects.toEqual(new CapabilityMissing("interrupt"));
        });
      }),
      under.timeoutMs,
    );

    it.runIf(can.resume && can.officeTools)(
      "resumes an ended session by its id, with its conversation",
      scenario("resume", async (engine, options) => {
        const notes = noteTool();
        const withNotes = { ...options, officeTools: [notes.tool] };
        const id = randomUUID();
        const first = await engine.start({
          id,
          options: withNotes,
          brief: message(
            'Remember the word "tangerine" for later. Do not call any tool now; reply with the single word: ok',
          ),
        });
        expect((await new EventLog(first).nextTurn()).outcome).toBe("completed");
        expect(notes.calls).toEqual([]);
        await first.end();

        const resumed = await engine.resume(id, withNotes);
        expect(resumed.id).toBe(id);
        const log = new EventLog(resumed);
        resumed.send(
          message(
            `Call the ${notes.tool.name} tool once with the word you were asked to remember, then reply with the single word: done`,
          ),
          "next",
        );
        expect((await log.nextTurn()).outcome).toBe("completed");
        expect(notes.calls).toEqual([{ input: { word: "tangerine" }, sessionId: id }]);
        await resumed.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.resume)(
      "refuses to resume without the resume capability",
      scenario("resume", async (engine, options) => {
        await expect(engine.resume(randomUUID(), options)).rejects.toEqual(
          new CapabilityMissing("resume"),
        );
      }),
      under.timeoutMs,
    );

    it.runIf(can.outputSchema)(
      "ends a turn in output that matches the session's output schema",
      scenario("output-schema", async (engine, options) => {
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, outputSchema: WORD_SCHEMA },
          brief: message("Answer with the word ready."),
        });
        const log = new EventLog(session);

        const turn = await log.nextTurn();
        expect(turn.outcome).toBe("completed");
        expect(turn.output).toEqual({ word: expect.any(String) });
        await session.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.outputSchema)(
      "refuses a session with an output schema without the outputSchema capability",
      scenario("output-schema", async (engine, options) => {
        const start = engine.start({
          id: randomUUID(),
          options: { ...options, outputSchema: WORD_SCHEMA },
          brief: message("Answer with the word ready."),
        });
        await expect(start).rejects.toEqual(new CapabilityMissing("outputSchema"));
      }),
      under.timeoutMs,
    );

    it.runIf(can.usageWindows)(
      "reads the account's usage windows",
      scenario("usage-windows", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          const windows = await session.readUsageWindows();
          expect(windows).toBeDefined();
          for (const window of [windows?.fiveHour, windows?.sevenDay]) {
            expect(window?.percentUsed).toBeGreaterThanOrEqual(0);
            expect(window?.percentUsed).toBeLessThanOrEqual(100);
          }
        });
      }),
      under.timeoutMs,
    );

    it.runIf(can.contextUsage)(
      "reads how full the context is between turns, within the model's window",
      scenario("context-usage", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          const usage = await session.readContextUsage();
          expect(usage.tokens).toBeGreaterThan(0);
          expect(usage.window).toBeGreaterThan(usage.tokens);
        });
      }),
      under.timeoutMs,
    );

    it.skipIf(can.contextUsage)(
      "refuses to read the context usage without the contextUsage capability",
      scenario("reply", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          await expect(session.readContextUsage()).rejects.toEqual(
            new CapabilityMissing("contextUsage"),
          );
        });
      }),
      under.timeoutMs,
    );

    it.skipIf(can.usageWindows)(
      "refuses to read the usage windows without the usageWindows capability",
      scenario("reply", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          await expect(session.readUsageWindows()).rejects.toEqual(
            new CapabilityMissing("usageWindows"),
          );
        });
      }),
      under.timeoutMs,
    );
  });
}

const READ_ONLY = {
  edit: false,
  run: { kind: "read-only-git" },
  web: false,
  mcpTools: {},
} as const;

const RUNS_ANYTHING = { ...READ_ONLY, run: { kind: "anything" } } as const;

/** Writes a line a second for three seconds, so its output comes in several reads. */
const COUNTING_COMMAND = `node -e "for (let i = 1; i <= 3; i++) setTimeout(() => console.log('line ' + i), i * 1000)"`;

/** Writes until it is stopped. */
const TICKING_COMMAND = `node -e "setInterval(() => console.log('tick'), 500)"`;

const NOTED = "Noted.";

/** Why the Office rules refuse an edit to a session whose profile has none. */
const EDIT_REFUSAL = "Not allowed in this session: editing files.";

const WORD_SCHEMA = {
  type: "object",
  properties: { word: { type: "string" } },
  required: ["word"],
  additionalProperties: false,
};

const FAKE_SERVER = "fake";
const SERVER_VALUE_NAME = "FAKE_SERVER_VALUE";
const SERVER_VALUE = "kumquat";
const CONSULT_DEVOPS = { kind: "consult", role: "devops" } as const;

/** One of each setting: an Allowed tool, one on approval and one never run. */
const FAKE_TOOL_SETTINGS = {
  [`${FAKE_SERVER}/environment-variable`]: { kind: "allowed" },
  [`${FAKE_SERVER}/started-process`]: CONSULT_DEVOPS,
  [`${FAKE_SERVER}/echo`]: { kind: "never" },
} as const;

function mcpToolName(tool: string): string {
  return `mcp__${FAKE_SERVER}__${tool}`;
}

/** The fake local MCP server with a Server value, started in the session's folder. */
function fakeServer(mcpServer: ContractMcpServer, folder: string): SessionMcpServer {
  return {
    name: FAKE_SERVER,
    launch: mcpServer.launch({ [SERVER_VALUE_NAME]: SERVER_VALUE }, folder),
    tools: [
      {
        name: "echo",
        description: "Answers with the text it is given.",
        inputSchema: objectSchema({ text: { type: "string" } }),
      },
      {
        name: "environment-variable",
        description: "Answers with an environment variable's value.",
        inputSchema: objectSchema({ name: { type: "string" } }),
      },
      {
        name: "started-process",
        description: "Answers with the id of the process the server started.",
        inputSchema: objectSchema({}),
      },
    ],
  };
}

function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties) };
}

function defaultOptions(
  folder: string,
  { engine, model }: Pick<EngineUnderContract, "engine" | "model">,
): SessionOptions {
  return {
    folder,
    environment: inheritedEnvironment(),
    engine,
    model,
    effort: "low",
    skills: undefined,
    profile: READ_ONLY,
    officeTools: [],
    mcpServers: [],
    languageServers: [],
    instructions: "",
    outputSchema: undefined,
  };
}

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function message(text: string): UserMessage {
  return { id: randomUUID(), text };
}

/** A session through one turn on a short reply, with `afterTurn` done before it ends. */
async function replyingSession(
  engine: AgentEngine,
  options: SessionOptions,
  afterTurn: (session: EngineSession) => Promise<void>,
): Promise<void> {
  const session = await engine.start({
    id: randomUUID(),
    options,
    brief: message("Reply with the single word: ok"),
  });
  await new EventLog(session).nextTurn();
  await afterTurn(session);
  await session.end();
}

/** An Office tool that keeps what it is called with. */
function noteTool() {
  const calls: { readonly input: unknown; readonly sessionId: string }[] = [];
  /** Each call's judge of command lines, in the order of `calls`. */
  const judges: OfficeToolCall["judgeCommand"][] = [];
  const tool: OfficeTool = {
    name: "note",
    description: "Notes down one word for The Office.",
    input: z.object({ word: z.string() }),
    run: (input, { sessionId, judgeCommand }) => {
      calls.push({ input, sessionId });
      judges.push(judgeCommand);
      return Promise.resolve({ text: NOTED, isError: false });
    },
  };
  return { tool, calls, judges };
}

/**
 * A command line an Office tool runs for the Agent is judged as the session's own shell call: by
 * its read-only git profile, git, and the container runtime, in the same words.
 */
async function expectCommandsJudgedAsTheSessionsShell(
  judge: OfficeToolCall["judgeCommand"] | undefined,
): Promise<void> {
  if (judge === undefined) throw new Error("The Office tool was not called.");
  await expect(judge("git status")).resolves.toEqual({ allowed: true });
  await expect(judge("npm test")).resolves.toEqual({
    allowed: false,
    reason: expect.stringContaining("Not allowed in this session"),
  });
  await expect(judge("git commit -m wip")).resolves.toEqual({
    allowed: false,
    reason: expect.stringContaining("Agents never change git (git commit)"),
  });
  await expect(judge("docker ps")).resolves.toEqual({
    allowed: false,
    reason: expect.stringContaining("run_project_command"),
  });
}

/** An Office tool that runs until the test releases it, so a turn is surely running meanwhile. */
function holdTool() {
  const released = signal();
  const called = signal();
  const tool: OfficeTool = {
    name: "hold",
    description: "Waits until The Office lets the work go on.",
    input: z.object({}),
    run: async () => {
      called.resolve();
      await released.promise;
      return { text: "Go on.", isError: false };
    },
  };
  return { tool, called: called.promise, release: () => released.resolve() };
}

/** A promise and what settles it. */
function signal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

function holdBrief(tool: OfficeTool): string {
  return `Call the ${tool.name} tool once, then reply with the single word: done`;
}

/** Reads a session's events as they come, for a test to wait on. */
class EventLog {
  readonly events: SessionEvent[] = [];
  readonly finished: Promise<void>;
  private turnsTaken = 0;
  private readonly waiters = new Set<() => void>();
  private failure: unknown;
  private ended = false;

  constructor(session: EngineSession) {
    this.finished = this.read(session);
    this.finished.catch(() => undefined);
  }

  /** The next turn's end not returned before. */
  nextTurn(): Promise<TurnEndedEvent> {
    const turn = this.turnsTaken++;
    return this.waitFor(() => this.turns()[turn]);
  }

  officeToolCall(tool: string): ToolCallEvent {
    const call = this.events.find(
      (event): event is ToolCallEvent =>
        event.kind === "tool-call" && event.officeTool && event.tool === tool,
    );
    if (call === undefined) throw new Error(`No call of the Office tool ${tool} was reported.`);
    return call;
  }

  toolCall(tool: string): ToolCallEvent {
    const call = this.events.find(
      (event): event is ToolCallEvent => event.kind === "tool-call" && event.tool === tool,
    );
    if (call === undefined) throw new Error(`No call of ${tool} was reported.`);
    return call;
  }

  call(callId: string): ToolCallEvent {
    const call = this.events.find(
      (event): event is ToolCallEvent => event.kind === "tool-call" && event.callId === callId,
    );
    if (call === undefined) throw new Error(`No tool call ${callId} was reported.`);
    return call;
  }

  refusal(): ToolRefusedEvent {
    const refusal = this.events.find(
      (event): event is ToolRefusedEvent => event.kind === "tool-refused",
    );
    if (refusal === undefined) throw new Error("No tool call was refused.");
    return refusal;
  }

  resultOf(call: ToolCallEvent): SessionEvent | undefined {
    return this.events.find(
      (event) => event.kind === "tool-result" && event.callId === call.callId,
    );
  }

  /** The first Process's end, once it comes. */
  processEnded(): Promise<ProcessEndedEvent> {
    return this.waitFor(() =>
      this.events.find((event): event is ProcessEndedEvent => event.kind === "process-ended"),
    );
  }

  processStarted(): ProcessStartedEvent {
    const started = this.events.find(
      (event): event is ProcessStartedEvent => event.kind === "process-started",
    );
    if (started === undefined) throw new Error("No Process start was reported.");
    return started;
  }

  /** A Process's output as reported so far, joined in order. */
  outputOf(callId: string): string {
    return this.events
      .flatMap((event) =>
        event.kind === "process-output" && event.callId === callId ? [event.text] : [],
      )
      .join("");
  }

  private turns(): TurnEndedEvent[] {
    return this.events.filter((event): event is TurnEndedEvent => event.kind === "turn-ended");
  }

  private waitFor<T>(found: () => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = (): void => {
        const value = found();
        if (value !== undefined) {
          this.waiters.delete(check);
          resolve(value);
        } else if (this.ended) {
          this.waiters.delete(check);
          reject(
            this.failure ?? new Error("The session's events finished before what was awaited."),
          );
        }
      };
      this.waiters.add(check);
      check();
    });
  }

  private async read(session: EngineSession): Promise<void> {
    try {
      for await (const event of session.events) {
        this.events.push(event);
        this.notify();
      }
    } catch (error) {
      this.failure = error;
      throw error;
    } finally {
      this.ended = true;
      this.notify();
    }
  }

  private notify(): void {
    // A check removes itself from the set it is called from; Set iteration allows that.
    for (const check of this.waiters) check();
  }
}
