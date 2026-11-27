import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fakeStdioMcpServer } from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { CodexApiKey } from "../../domain/codex-api-key.js";
import {
  COPILOT_CLI_AUTO_MODEL,
  FIRST_CLAUDE_CODE_ENGINE,
  type Engine,
} from "../../domain/engines.js";
import {
  describeAgentEngineContract,
  SESSIONLESS_SCENARIOS,
  type ContractScenario,
} from "../../ports/agent-engine.contract.js";
import {
  SessionSkillsDiffer,
  type AgentEngine,
  type EngineCapabilities,
} from "../../ports/agent-engine.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { CODEX_CAPABILITIES } from "../codex/codex-engine.js";
import { COPILOT_CLI_CAPABILITIES } from "../copilot-cli/copilot-cli-engine.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import { RecordingEngine } from "./recording-engine.js";
import { DEFAULT_WINDOW_START, ScriptedEngine, ScriptMismatch } from "./scripted-engine.js";
import {
  PLACEHOLDERS,
  readRecording,
  type ScriptStep,
  type SessionScript,
} from "./session-script.js";

const RECORDINGS = fileURLToPath(new URL("./recordings/", import.meta.url));
const CODEX_RECORDINGS = join(RECORDINGS, "codex");

const CODEX_ENGINE: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};

const COPILOT_CLI_RECORDINGS = join(RECORDINGS, "copilot-cli");

const COPILOT_CLI_ENGINE: Engine = {
  id: "copilot-cli",
  name: "Copilot",
  kind: "copilot-cli",
  defaultModel: COPILOT_CLI_AUTO_MODEL,
  defaultEffort: null,
  token: null,
};

const NO_CAPABILITY: EngineCapabilities = {
  bargeIn: false,
  interrupt: false,
  resume: false,
  usageWindows: false,
  contextUsage: false,
  officeTools: false,
  outputSchema: false,
  languageServers: false,
  carrySession: false,
  startsUsageWindow: false,
};

describeAgentEngineContract("ScriptedEngine replaying the recordings", {
  capabilities: new ScriptedEngine([]).capabilities,
  engine: FIRST_CLAUDE_CODE_ENGINE,
  model: "scripted",
  timeoutMs: 20_000,
  mcpServer: CONTRACT_MCP_SERVER,
  backgroundCommands: true,
  usageWindowUsedUp: true,
  failedTurns: true,
  windowStart: { sessionsKept: scriptedSessions },
  engineFor: (scenario) => replaying(RECORDINGS, scenario),
});

describeAgentEngineContract("ScriptedEngine without capabilities", {
  capabilities: NO_CAPABILITY,
  engine: FIRST_CLAUDE_CODE_ENGINE,
  model: "scripted",
  timeoutMs: 20_000,
  mcpServer: CONTRACT_MCP_SERVER,
  backgroundCommands: true,
  usageWindowUsedUp: true,
  failedTurns: true,
  engineFor: (scenario) => replaying(RECORDINGS, scenario, NO_CAPABILITY),
});

describeAgentEngineContract("ScriptedEngine replaying the Codex recordings", {
  capabilities: CODEX_CAPABILITIES,
  engine: CODEX_ENGINE,
  model: "gpt-6-luna",
  timeoutMs: 20_000,
  // The recordings' account is on ChatGPT Free, whose one window is 30 days.
  fiveHourAndSevenDayWindows: false,
  mcpServer: CONTRACT_MCP_SERVER,
  backgroundCommands: false,
  windowStart: { sessionsKept: scriptedSessions },
  engineFor: (scenario) => replaying(CODEX_RECORDINGS, scenario, CODEX_CAPABILITIES),
});

describeAgentEngineContract("ScriptedEngine replaying the Copilot CLI recordings", {
  capabilities: COPILOT_CLI_CAPABILITIES,
  engine: COPILOT_CLI_ENGINE,
  model: COPILOT_CLI_AUTO_MODEL,
  timeoutMs: 20_000,
  mcpServer: CONTRACT_MCP_SERVER,
  backgroundCommands: false,
  engineFor: (scenario) => replaying(COPILOT_CLI_RECORDINGS, scenario, COPILOT_CLI_CAPABILITIES),
});

/** The sessions a scripted engine started or resumed, by id: what a window start must not add to. */
function scriptedSessions(engine: AgentEngine): Promise<readonly string[]> {
  return Promise.resolve(
    engine instanceof ScriptedEngine ? engine.sessions.map((session) => session.id) : [],
  );
}

/**
 * A scenario's engine: on its recording, or with the account's windows set for a scenario that
 * opens no session and so has none.
 */
async function replaying(
  recordings: string,
  scenario: ContractScenario,
  capabilities: Partial<EngineCapabilities> = {},
): Promise<ScriptedEngine> {
  if (!SESSIONLESS_SCENARIOS.includes(scenario)) {
    return new ScriptedEngine(
      await readRecording(join(recordings, `${scenario}.jsonl`)),
      capabilities,
    );
  }
  const engine = new ScriptedEngine([], capabilities);
  engine.setUsageWindows(FIRST_CLAUDE_CODE_ENGINE.id, {
    fiveHour: { percentUsed: 12, resetsAt: new Date("2027-01-15T10:00:00Z") },
    sevenDay: { percentUsed: 30, resetsAt: new Date("2027-01-20T10:00:00Z") },
    source: "usage-endpoint",
  });
  return engine;
}

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-scripted-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

function options(): SessionOptions {
  return {
    folder,
    environment: {},
    engine: FIRST_CLAUDE_CODE_ENGINE,
    model: "scripted",
    effort: "low",
    skills: undefined,
    profile: { edit: true, run: { kind: "anything" }, web: false, mcpTools: {} },
    officeTools: [],
    mcpServers: [],
    languageServers: [],
    instructions: "",
    outputSchema: undefined,
  };
}

const TURN_ENDED: SessionEvent = {
  kind: "turn-ended",
  outcome: "completed",
  consumedMessageIds: ["brief"],
  usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
  sessionCostUsd: 0,
  output: undefined,
  errors: [],
};

/** Reads `file` in the working folder, then reports reading it. */
const READS_A_FILE: SessionScript = [
  { step: "start", brief: { id: "brief", text: "Read the plan." } },
  {
    step: "event",
    event: {
      kind: "tool-call",
      callId: "call-1",
      tool: "Read",
      officeTool: false,
      input: { file_path: `${PLACEHOLDERS.folder}/plan.md`, home: `${PLACEHOLDERS.home}/.ssh` },
      withinToolCall: undefined,
    },
  },
  { step: "event", event: TURN_ENDED },
  { step: "end" },
];

async function readAll(events: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const read: SessionEvent[] = [];
  for await (const event of events) read.push(event);
  return read;
}

function mcpCall(callId: string, tool: string, recorded: string): ScriptStep[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool,
        officeTool: false,
        input: {},
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: {
        kind: "tool-result",
        callId,
        text: recorded,
        isError: false,
        withinToolCall: undefined,
      },
    },
  ];
}

/** Calls two tools of the fake MCP server, as recorded on a session that allowed both. */
const CALLS_MCP_TOOLS: SessionScript = [
  { step: "start", brief: { id: "brief", text: "Use the fake server." } },
  ...mcpCall("call-1", "mcp__fake__started-process", "recorded"),
  ...mcpCall("call-2", "mcp__fake__echo", "recorded"),
  { step: "event", event: TURN_ENDED },
  { step: "end" },
];

describe("ScriptedEngine", () => {
  it("runs an allowed MCP call on the session's server, holds one on approval, and ends the server with the session", async () => {
    const engine = new ScriptedEngine([CALLS_MCP_TOOLS]);
    const session = await engine.start({
      id: randomUUID(),
      options: {
        ...options(),
        profile: {
          ...options().profile,
          mcpTools: {
            "fake/started-process": { kind: "allowed" },
            "fake/echo": { kind: "ask-me" },
          },
        },
        mcpServers: [{ name: "fake", launch: fakeStdioMcpServer(), tools: [] }],
        approvalHold: () => Promise.resolve("It waits on your answer."),
      },
      brief: { id: randomUUID(), text: "Use the fake server." },
    });
    const reported = session.events[Symbol.asyncIterator]();
    const events: SessionEvent[] = [];
    while (events.at(-1)?.kind !== "turn-ended") events.push((await reported.next()).value);
    const started = events.find(
      (event) => event.kind === "tool-result" && event.callId === "call-1",
    );
    const startedProcess = Number(started?.kind === "tool-result" ? started.text : Number.NaN);
    expect(isRunning(startedProcess)).toBe(true);
    expect(events.filter((event) => event.kind === "tool-refused")).toEqual([
      {
        kind: "tool-refused",
        callId: "call-2",
        tool: "mcp__fake__echo",
        reason: "It waits on your answer.",
        refusedBy: "office-rules",
      },
    ]);

    await session.end();
    await vi.waitFor(() => expect(isRunning(startedProcess)).toBe(false), { timeout: 10_000 });
  });

  it("names the session's own folder and home where the script names them", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Read the plan." },
    });
    const reading = readAll(session.events);
    await session.end();

    expect((await reading)[0]).toMatchObject({
      input: { file_path: `${folder}/plan.md`, home: `${homedir()}/.ssh` },
    });
  });

  it("names the caller's message ids in the turns that took them, and keeps what the caller did", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const brief = { id: randomUUID(), text: "Read the plan, please." };
    const session = await engine.start({ id: randomUUID(), options: options(), brief });
    const reading = readAll(session.events);
    await session.end();

    expect((await reading).at(-1)).toMatchObject({ consumedMessageIds: [brief.id] });
    expect(engine.sessions[0]?.received).toEqual([{ step: "start", brief }, { step: "end" }]);
  });

  it("gives a refused turn's reset the seconds after the replay its step names, for a test to see it come", async () => {
    const refused: SessionEvent = {
      ...TURN_ENDED,
      outcome: "usage-window-used-up",
      usedUpWindow: { window: "five-hour", resetsAt: new Date(0), resetGiven: true },
    };
    const engine = new ScriptedEngine([
      [
        { step: "start", brief: { id: "brief", text: "Build it." } },
        { step: "event", event: refused, resetsInSeconds: 30 },
        { step: "end" },
      ],
    ]);
    const before = Date.now();
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Build it." },
    });
    const reading = readAll(session.events);
    await vi.waitFor(() => expect(engine.sessions[0]?.reportedEvents).toHaveLength(1));
    await session.end();

    const [ended] = await reading;
    expect(
      ended?.kind === "turn-ended" && ended.usedUpWindow?.resetsAt.getTime(),
    ).toBeGreaterThanOrEqual(before + 30_000);
  });

  it("holds at a wait step until the test reaches its mark, the events before it reported", async () => {
    const script: SessionScript = [
      { step: "start", brief: { id: "brief", text: "Start the dev server." } },
      { step: "event", event: TURN_ENDED },
      output("ready\n"),
      { step: "wait", mark: "page opened" },
      output("GET /\n"),
      { step: "end" },
    ];
    const engine = new ScriptedEngine([script]);
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Start the dev server." },
    });
    const scripted = engine.sessions[0];
    const reading = readAll(session.events);

    await vi.waitFor(() => expect(scripted?.reportedEvents).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scripted?.reportedEvents).toHaveLength(2);
    scripted?.reach("page opened");
    await session.end();

    expect((await reading).slice(1)).toEqual([
      { kind: "process-output", callId: "call-1", text: "ready\n" },
      { kind: "process-output", callId: "call-1", text: "GET /\n" },
    ]);
  });

  it("refuses each call while the session's tool hold does, as the Office rules hook would, running no Office tool", async () => {
    const ran: string[] = [];
    const held = "Refused by The Office: the fire alarm is on.";
    const script: SessionScript = [
      { step: "start", brief: { id: "brief", text: "Read the Task." } },
      {
        step: "event",
        event: {
          kind: "tool-call",
          callId: "call-1",
          tool: "read_task",
          officeTool: true,
          input: {},
          withinToolCall: undefined,
        },
      },
      {
        step: "event",
        event: {
          kind: "tool-result",
          callId: "call-1",
          text: "The Task.",
          isError: false,
          withinToolCall: undefined,
        },
      },
      { step: "event", event: TURN_ENDED },
      { step: "end" },
    ];
    const engine = new ScriptedEngine([script]);
    const session = await engine.start({
      id: randomUUID(),
      options: {
        ...options(),
        officeTools: [
          {
            name: "read_task",
            description: "Reads the Task.",
            input: z.object({}),
            run: () => {
              ran.push("read_task");
              return Promise.resolve({ text: "The Task.", isError: false });
            },
          },
        ],
        toolHold: () => Promise.resolve(held),
      },
      brief: { id: randomUUID(), text: "Read the Task." },
    });
    const reading = readAll(session.events);
    await session.end();

    expect((await reading).slice(1, 3)).toEqual([
      { kind: "tool-result", callId: "call-1", text: held, isError: true },
      {
        kind: "tool-refused",
        callId: "call-1",
        tool: "read_task",
        reason: held,
        refusedBy: "office-rules",
      },
    ]);
    expect(ran).toEqual([]);
  });

  it("fills a call's <brief:Kind> with the id the session's Brief gives that record, and fails without one", async () => {
    const initiativeId = randomUUID();
    const given: unknown[] = [];
    const script: SessionScript = [
      { step: "start", brief: { id: "brief", text: "Shape the Initiative." } },
      {
        step: "event",
        event: {
          kind: "tool-call",
          callId: "call-1",
          tool: "write_initiative_outcome",
          officeTool: true,
          input: { initiativeId: "<brief:Initiative>", outcome: "Usage exports." },
          withinToolCall: undefined,
        },
      },
      {
        step: "event",
        event: {
          kind: "tool-result",
          callId: "call-1",
          text: "",
          isError: false,
          withinToolCall: undefined,
        },
      },
      { step: "event", event: TURN_ENDED },
      { step: "end" },
    ];
    const started = async (brief: string) => {
      const engine = new ScriptedEngine([script]);
      const session = await engine.start({
        id: randomUUID(),
        options: {
          ...options(),
          officeTools: [
            {
              name: "write_initiative_outcome",
              description: "Writes the outcome.",
              input: z.object({ initiativeId: z.uuid(), outcome: z.string() }),
              run: (input) => {
                given.push(input);
                return Promise.resolve({ text: "Written.", isError: false });
              },
            },
          ],
        },
        brief: { id: randomUUID(), text: brief },
      });
      return { session, reading: readAll(session.events) };
    };

    const named = await started(`## The Initiative\n\nUsage exports (Initiative ${initiativeId})`);
    await named.session.end();
    expect((await named.reading)[0]).toMatchObject({
      kind: "tool-call",
      input: { initiativeId, outcome: "Usage exports." },
    });
    expect(given).toEqual([{ initiativeId, outcome: "Usage exports." }]);

    const unnamed = await started("Shape the Initiative.");
    await expect(unnamed.reading).rejects.toThrow(
      "The session's Brief names no Initiative by its id.",
    );
  });

  it("fails the session when the caller does something other than the script's next step", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Read the plan." },
    });
    const reading = readAll(session.events);

    await expect(session.interrupt()).rejects.toThrow(
      "the script has its caller end next, but the caller asked to interrupt.",
    );
    await expect(reading).rejects.toBeInstanceOf(ScriptMismatch);
  });

  it("answers an engine's usage windows as the test sets them or fails them, counting each read", async () => {
    const engine = new ScriptedEngine([]);
    const signal = new AbortController().signal;
    const windows = {
      fiveHour: { percentUsed: 100, resetsAt: new Date("2027-01-15T10:00:00Z") },
      sevenDay: { percentUsed: 30, resetsAt: undefined },
      source: "usage-endpoint",
    } as const;

    await expect(
      engine.readUsageWindows(FIRST_CLAUDE_CODE_ENGINE, signal),
    ).resolves.toBeUndefined();
    engine.setUsageWindows(FIRST_CLAUDE_CODE_ENGINE.id, windows);
    await expect(engine.readUsageWindows(FIRST_CLAUDE_CODE_ENGINE, signal)).resolves.toEqual(
      windows,
    );
    engine.failUsageWindowReads(FIRST_CLAUDE_CODE_ENGINE.id, new Error("No answer."));
    await expect(engine.readUsageWindows(FIRST_CLAUDE_CODE_ENGINE, signal)).rejects.toThrow(
      "No answer.",
    );
    // A Codex account on an API key has no windows to read.
    await expect(
      engine.readUsageWindows(
        {
          id: "codex",
          name: "Codex",
          kind: "codex",
          defaultModel: "gpt-6-luna",
          defaultEffort: null,
          apiKey: CodexApiKey.of("sk-test"),
        },
        signal,
      ),
    ).resolves.toBeUndefined();

    expect(engine.usageWindowReads).toEqual([
      FIRST_CLAUDE_CODE_ENGINE.id,
      FIRST_CLAUDE_CODE_ENGINE.id,
      FIRST_CLAUDE_CODE_ENGINE.id,
    ]);
  });

  it("starts an engine's 5-hour window as the test sets it, counting each start, and reads on as set", async () => {
    const engine = new ScriptedEngine([]);
    const signal = new AbortController().signal;
    const opened = {
      fiveHour: { percentUsed: 1, resetsAt: new Date("2027-01-15T15:00:00Z") },
      sevenDay: { percentUsed: 30, resetsAt: undefined },
      source: "usage-endpoint",
    } as const;
    const answer = {
      tokens: { input: 7, output: 1, cacheRead: 3, cacheCreation: 0 },
      model: "claude-haiku-5-5",
    };

    await expect(engine.startUsageWindow(FIRST_CLAUDE_CODE_ENGINE, signal)).resolves.toEqual(
      DEFAULT_WINDOW_START,
    );
    await expect(
      engine.readUsageWindows(FIRST_CLAUDE_CODE_ENGINE, signal),
    ).resolves.toBeUndefined();
    engine.setWindowsAfterStart(FIRST_CLAUDE_CODE_ENGINE.id, opened);
    engine.setWindowStart(FIRST_CLAUDE_CODE_ENGINE.id, answer);
    await expect(engine.startUsageWindow(FIRST_CLAUDE_CODE_ENGINE, signal)).resolves.toEqual(
      answer,
    );
    await expect(engine.readUsageWindows(FIRST_CLAUDE_CODE_ENGINE, signal)).resolves.toEqual(
      opened,
    );
    engine.failWindowStarts(FIRST_CLAUDE_CODE_ENGINE.id, new Error("Refused."));
    await expect(engine.startUsageWindow(FIRST_CLAUDE_CODE_ENGINE, signal)).rejects.toThrow(
      "Refused.",
    );

    expect(engine.windowStarts).toEqual([
      FIRST_CLAUDE_CODE_ENGINE.id,
      FIRST_CLAUDE_CODE_ENGINE.id,
      FIRST_CLAUDE_CODE_ENGINE.id,
    ]);
    expect(engine.sessions).toEqual([]);
  });

  it("refuses a session no script is left for, and a request once the script has ended", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Read the plan." },
    });
    await session.end();

    await expect(session.interrupt()).rejects.toBeInstanceOf(ScriptMismatch);
    await expect(
      engine.start({
        id: randomUUID(),
        options: options(),
        brief: { id: randomUUID(), text: "Again." },
      }),
    ).rejects.toThrow("No script is left");
  });

  describe("the start check", () => {
    const skills = {
      folder: join(tmpdir(), "office-session", "skills"),
      names: ["office:tdd"],
      expected: ["office:tdd"],
      userOnly: [],
      overrides: {},
    };
    const start = (engine: ScriptedEngine) =>
      engine.start({
        id: "s-1",
        options: { ...options(), skills },
        brief: { id: randomUUID(), text: "Begin." },
      });

    it("starts a session whose script lists exactly its skills", async () => {
      const session = await start(new ScriptedEngine([listing(["office:tdd"])]));

      await expect(session.end()).resolves.toBeUndefined();
    });

    it("refuses a session whose script lists other skills, with the difference", async () => {
      await expect(
        start(new ScriptedEngine([listing(["office:tdd", "office:grilling"])])),
      ).rejects.toThrow(
        new SessionSkillsDiffer("s-1", ["It lists office:grilling, which it shouldn't have."]),
      );
    });
  });
});

/** A session that lists `listedSkills` as it opens, and ends. */
function listing(listedSkills: string[]): SessionScript {
  return [{ step: "start", brief: { id: "brief", text: "Begin." }, listedSkills }, { step: "end" }];
}

describe("the Test Project check's recording", () => {
  it("replays a session refused a git commit and an ~/.ssh read by the Office rules", async () => {
    const engine = new ScriptedEngine(await readRecording(join(RECORDINGS, "test-project.jsonl")));
    const session = await engine.start({
      id: randomUUID(),
      options: {
        ...options(),
        profile: { edit: false, run: { kind: "read-only-git" }, web: false, mcpTools: {} },
      },
      brief: { id: randomUUID(), text: "Read, commit, read a secret." },
    });
    const reading = readAll(session.events);
    await session.end();

    const refusals = (await reading).filter((event) => event.kind === "tool-refused");
    expect(refusals.map(({ tool, refusedBy }) => [tool, refusedBy])).toEqual([
      ["Bash", "office-rules"],
      ["Read", "office-rules"],
    ]);
  });
});

describe("RecordingEngine", () => {
  it("records what a session's caller did and what it reported, for the scripted engine to replay", async () => {
    const recording = new RecordingEngine(new ScriptedEngine([READS_A_FILE]));
    const brief = { id: "brief", text: "Read the plan." };
    const session = await recording.start({ id: randomUUID(), options: options(), brief });
    for await (const event of session.events) {
      if (event.kind === "turn-ended") break;
    }
    await session.end();
    const file = join(folder, "recording.jsonl");

    await recording.save(file);

    expect(await readRecording(file)).toEqual([READS_A_FILE]);
    const written = await readFile(file, "utf8");
    expect(written).not.toContain(folder);
    expect(written).not.toContain(homedir());
  });

  it("records an MCP server that failed to start, with or without why, for the scripted engine to report", async () => {
    const withoutWhy: SessionEvent = {
      kind: "mcp-server-not-started",
      server: "github",
      reason: undefined,
    };
    const withWhy: SessionEvent = {
      kind: "mcp-server-not-started",
      server: "linear",
      reason: "It exited with 1.",
    };
    const notStarted: SessionScript = [
      { step: "start", brief: { id: "brief", text: "Begin." } },
      { step: "event", event: withoutWhy },
      { step: "event", event: withWhy },
      { step: "event", event: TURN_ENDED },
      { step: "end" },
    ];
    const recording = new RecordingEngine(new ScriptedEngine([notStarted]));
    const brief = { id: "brief", text: "Begin." };
    const session = await recording.start({ id: randomUUID(), options: options(), brief });
    const reported: SessionEvent[] = [];
    for await (const event of session.events) {
      reported.push(event);
      if (event.kind === "turn-ended") break;
    }
    await session.end();
    const file = join(folder, "recording.jsonl");

    await recording.save(file);

    expect(reported.slice(0, 2)).toEqual([withoutWhy, withWhy]);
    expect(await readRecording(file)).toEqual([notStarted]);
  });

  it("keeps a skill command's skill and input, for a test to see what its caller sent", async () => {
    const command = {
      id: "command",
      text: "/office:release v2",
      skillCommand: { skill: "office:release", input: "v2" },
    };
    const script: SessionScript = [
      { step: "start", brief: { id: "brief", text: "Begin." } },
      { step: "send", message: command, priority: "later" },
      { step: "event", event: TURN_ENDED },
      { step: "event", event: { ...TURN_ENDED, consumedMessageIds: ["command"] } },
      { step: "end" },
    ];
    const replayed = new ScriptedEngine([script]);
    const recording = new RecordingEngine(replayed);
    const session = await recording.start({
      id: randomUUID(),
      options: options(),
      brief: { id: "brief", text: "Begin." },
    });
    session.send(command, "later");
    let turnsEnded = 0;
    for await (const event of session.events) {
      if (event.kind === "turn-ended" && ++turnsEnded === 2) break;
    }
    await session.end();
    const file = join(folder, "recording.jsonl");

    await recording.save(file);

    expect(replayed.sessions[0]?.received).toContainEqual({
      step: "send",
      message: command,
      priority: "later",
    });
    expect(await readRecording(file)).toEqual([script]);
  });

  it("keeps each image's name, media type and size, never its bytes, and replays the message", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    const message = {
      id: "message",
      text: "What is wrong here?",
      images: [
        {
          attachmentId: "0c6f5d1e-3a5b-4f0e-9a52-2d2f0e1c9b10",
          name: "screen.png",
          mediaType: "image/png",
          content: bytes,
        },
      ],
    };
    const recorded = {
      id: "message",
      text: "What is wrong here?",
      images: [{ name: "screen.png", mediaType: "image/png", size: 6 }],
    };
    const script: SessionScript = [
      { step: "start", brief: { id: "brief", text: "Begin." } },
      { step: "send", message: recorded, priority: "next" },
      { step: "event", event: TURN_ENDED },
      { step: "event", event: { ...TURN_ENDED, consumedMessageIds: ["message"] } },
      { step: "end" },
    ];
    const replayed = new ScriptedEngine([script]);
    const recording = new RecordingEngine(replayed);
    const session = await recording.start({
      id: randomUUID(),
      options: options(),
      brief: { id: "brief", text: "Begin." },
    });
    session.send(message, "next");
    let turnsEnded = 0;
    for await (const event of session.events) {
      if (event.kind === "turn-ended" && ++turnsEnded === 2) break;
    }
    await session.end();
    const file = join(folder, "recording.jsonl");

    await recording.save(file);

    expect(replayed.sessions[0]?.received).toContainEqual({
      step: "send",
      message: recorded,
      priority: "next",
    });
    expect(await readRecording(file)).toEqual([script]);
    expect(await readFile(file, "utf8")).not.toContain("attachmentId");
  });
});

function output(text: string): ScriptStep {
  return { step: "event", event: { kind: "process-output", callId: "call-1", text } };
}
