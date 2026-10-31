import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fakeStdioMcpServer } from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import { SessionSkillsDiffer, type EngineCapabilities } from "../../ports/agent-engine.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import { RecordingEngine } from "./recording-engine.js";
import { ScriptedEngine, ScriptMismatch } from "./scripted-engine.js";
import {
  PLACEHOLDERS,
  readRecording,
  type ScriptStep,
  type SessionScript,
} from "./session-script.js";

const RECORDINGS = fileURLToPath(new URL("./recordings/", import.meta.url));

const NO_CAPABILITY: EngineCapabilities = {
  bargeIn: false,
  interrupt: false,
  resume: false,
  usageWindows: false,
  contextUsage: false,
  officeTools: false,
  outputSchema: false,
};

describeAgentEngineContract("ScriptedEngine replaying the recordings", {
  capabilities: new ScriptedEngine([]).capabilities,
  model: "scripted",
  timeoutMs: 5000,
  mcpServer: CONTRACT_MCP_SERVER,
  engineFor: async (scenario) =>
    new ScriptedEngine(await readRecording(join(RECORDINGS, `${scenario}.jsonl`))),
});

describeAgentEngineContract("ScriptedEngine without capabilities", {
  capabilities: NO_CAPABILITY,
  model: "scripted",
  timeoutMs: 5000,
  mcpServer: CONTRACT_MCP_SERVER,
  engineFor: async (scenario) =>
    new ScriptedEngine(await readRecording(join(RECORDINGS, `${scenario}.jsonl`)), NO_CAPABILITY),
});

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
    model: "scripted",
    effort: "low",
    skills: undefined,
    profile: { edit: true, run: { kind: "anything" }, web: false, mcpTools: {} },
    officeTools: [],
    mcpServers: [],
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
    { step: "event", event: { kind: "tool-result", callId, text: recorded, isError: false } },
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
        event: { kind: "tool-result", callId: "call-1", text: "The Task.", isError: false },
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
});
