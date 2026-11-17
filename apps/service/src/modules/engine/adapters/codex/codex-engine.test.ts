import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SdkMcpClient } from "../../../../platform/mcp/sdk-mcp-client.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { CodexApiKey } from "../../domain/codex-api-key.js";
import type { CodexEngine, Engine } from "../../domain/engines.js";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import {
  type AgentEngine,
  ModelNotOffered,
  SessionSkillsDiffer,
} from "../../ports/agent-engine.js";
import type { EngineSession, UserMessage } from "../../ports/engine-session.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionEvent, TurnEndedEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import { RecordingEngine } from "../scripted/recording-engine.js";
import { codexAppServerArguments, codexEnvironment } from "./codex-arguments.js";
import { pinnedCodexPath } from "./codex-binary.js";
import {
  CODEX_CAPABILITIES,
  CodexAppServerEngine,
  DECLINED_CALLS,
  FILE_CHANGES,
  type CodexEngineSetup,
} from "./codex-engine.js";
import { CodexAppServer } from "./codex-rpc.js";
import { CodexThreadMissing } from "./codex-thread-file.js";
import { CodexWireRecorder } from "./codex-wire-recording.fixtures.js";
import {
  FAKE_FIVE_HOUR_RESET,
  FAKE_SEVEN_DAY_RESET,
  fakeAppServer,
  fakeAppServerRuns,
} from "./fake-app-server.fixtures.js";
import { replayingAppServer, unreplayedAppServers } from "./fake-codex-app-server.fixtures.js";

const ENGINE: CodexEngine = {
  id: "codex-tests",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  apiKey: null,
};

const READ_ONLY = {
  edit: false,
  run: { kind: "read-only-git" },
  web: false,
  mcpTools: {},
} as const;
const RUNS_ANYTHING = { ...READ_ONLY, run: { kind: "anything" } } as const;

const WORD_SCHEMA = {
  type: "object",
  properties: { word: { type: "string" } },
  required: ["word"],
  additionalProperties: false,
};

const NOTE_TOOL: OfficeTool = {
  name: "note",
  description: "Notes a word.",
  input: z.object({ word: z.string() }),
  run: () => Promise.resolve({ text: "Noted.", isError: false }),
};

function message(text: string): UserMessage {
  return { id: randomUUID(), text };
}

/** Reads a session's events as they come. */
function reading(session: EngineSession) {
  const events: SessionEvent[] = [];
  const finished = (async () => {
    for await (const event of session.events) events.push(event);
  })();
  finished.catch(() => undefined);
  const turns = () =>
    events.filter((event): event is TurnEndedEvent => event.kind === "turn-ended");
  const turn = async (index: number): Promise<TurnEndedEvent> => {
    await vi.waitFor(
      () => {
        if (turns()[index] === undefined) throw new Error(`Turn ${index} hasn't ended.`);
      },
      { timeout: 10_000, interval: 20 },
    );
    return turns()[index] as TurnEndedEvent;
  };
  return { events, finished, turn };
}

describe("CodexAppServerEngine on a stand-in app-server", () => {
  let officeData: string;
  let folder: string;
  let report: string;
  const sessions: EngineSession[] = [];

  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-codex-data-"));
    folder = await mkdtemp(join(tmpdir(), "office-codex-folder-"));
    report = join(officeData, "app-server.jsonl");
  });

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.end()));
    await rm(officeData, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  function engineOn(setup: CodexEngineSetup = {}): CodexAppServerEngine {
    return new CodexAppServerEngine(new OfficeDataDirectory(officeData), new SdkMcpClient(), {
      ...fakeAppServer(report),
      ...setup,
    });
  }

  function options(overrides: Partial<SessionOptions> = {}): SessionOptions {
    return {
      folder,
      environment: {
        PATH: process.env["PATH"] ?? "",
        OPENAI_API_KEY: "sk-not-for-codex",
        CODEX_API_KEY: "not-for-codex",
      },
      engine: ENGINE,
      model: "gpt-6-luna",
      effort: "low",
      instructions: "Be brief.",
      skills: undefined,
      profile: READ_ONLY,
      officeTools: [],
      mcpServers: [],
      languageServers: [],
      outputSchema: undefined,
      ...overrides,
    };
  }

  async function started(
    brief: UserMessage,
    overrides: Partial<SessionOptions> = {},
    engine = engineOn(),
  ) {
    const id = randomUUID();
    const session = await engine.start({ id, options: options(overrides), brief });
    sessions.push(session);
    return { id, session, log: reading(session) };
  }

  /** Once the stand-in has started a turn, so the session has one running. */
  async function turnStarted(count = 1): Promise<void> {
    await vi.waitFor(async () => {
      const runs = await fakeAppServerRuns(report);
      const turnStarts = runs.flatMap(({ received }) =>
        received.filter(({ method }) => method === "turn/start"),
      );
      if (turnStarts.length < count) throw new Error("No turn has started yet.");
    });
    // The stand-in answers turn/start at once; give the session the answer.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it("runs the app-server with settings as -c overrides, the endpoint's token only in thread/start's config, and no Server value", async () => {
    const { session, log } = await started(message("answer hi"), {
      officeTools: [NOTE_TOOL],
      mcpServers: [
        {
          name: "fake",
          launch: CONTRACT_MCP_SERVER.launch({ FAKE_SERVER_VALUE: "kumquat" }, folder),
          tools: [],
        },
      ],
    });
    await log.turn(0);
    await session.end();

    const [run] = await fakeAppServerRuns(report);
    if (run === undefined) throw new Error("The app-server never started.");
    const threadStart = run.received.find(({ method }) => method === "thread/start");
    const token = /^Bearer ([\w-]{43})$/.exec(
      JSON.stringify(threadStart?.params).match(/"Authorization":"([^"]*)"/)?.[1] ?? "",
    )?.[1];
    if (token === undefined) throw new Error("thread/start named no endpoint token.");
    expect(run.argv).toEqual(codexAppServerArguments());
    const commandLineAndEnvironment = JSON.stringify({ argv: run.argv, env: run.env });
    expect(commandLineAndEnvironment).not.toContain(token);
    expect(JSON.stringify(run)).not.toContain("kumquat");
    expect(run.env["CODEX_HOME"]).toBe(join(officeData, "engines", ENGINE.id));
    expect(run.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(run.env).not.toHaveProperty("CODEX_API_KEY");
    expect(threadStart?.params).toMatchObject({
      cwd: folder,
      model: "gpt-6-luna",
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
      developerInstructions: `Be brief.\n\n${FILE_CHANGES} ${DECLINED_CALLS}`,
      config: {
        model_reasoning_effort: "low",
        projects: { [folder]: { trust_level: "untrusted" } },
        mcp_servers: {
          office: {
            url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/office$/),
            http_headers: { Authorization: `Bearer ${token}` },
          },
          fake: {
            url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/fake$/),
            http_headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
    });
    expect(isRunning(run.processId)).toBe(false);
  });

  it("reports the Agent's text and a turn's tokens, cached input as cache reads, and the context it read", async () => {
    const brief = message("answer hello");
    const { session, log } = await started(brief);

    const turn = await log.turn(0);
    expect(log.events).toContainEqual({ kind: "text", text: "hello", withinToolCall: undefined });
    expect(turn).toMatchObject({
      outcome: "completed",
      consumedMessageIds: [brief.id],
      usage: { input: 60, cacheRead: 40, output: 10, cacheCreation: 0 },
      sessionCostUsd: 0,
      errors: [],
    });
    await expect(session.readContextUsage()).resolves.toEqual({ tokens: 110, window: 200_000 });
  });

  it("reads a ChatGPT account's usage windows from account/rateLimits/read", async () => {
    const { session, log } = await started(message("answer hi"));
    await log.turn(0);

    await expect(session.readUsageWindows()).resolves.toEqual({
      fiveHour: { percentUsed: 12, resetsAt: new Date(FAKE_FIVE_HOUR_RESET * 1000) },
      sevenDay: { percentUsed: 30, resetsAt: new Date(FAKE_SEVEN_DAY_RESET * 1000) },
      source: "usage-endpoint",
    });
    const [run] = await fakeAppServerRuns(report);
    expect(run?.received.map(({ method }) => method)).toContain("account/rateLimits/read");
  });

  it("reads no usage windows on an API key, asking the app-server nothing", async () => {
    const { session, log } = await started(message("answer hi"), {
      engine: { ...ENGINE, apiKey: CodexApiKey.of("sk-test") },
    });
    await log.turn(0);

    await expect(session.readUsageWindows()).resolves.toBeUndefined();
    const [run] = await fakeAppServerRuns(report);
    expect(run?.received.map(({ method }) => method)).not.toContain("account/rateLimits/read");
  });

  it("reports each rate-limit update as a reading of the fullest window", async () => {
    const { log } = await started(message("limits"));
    await log.turn(0);

    expect(log.events.filter((event) => event.kind === "rate-limit")).toEqual([
      {
        kind: "rate-limit",
        status: "allowed",
        window: "five-hour",
        resetsAt: new Date(FAKE_FIVE_HOUR_RESET * 1000),
      },
    ]);
  });

  it("reads the usage windows from the last rate-limit update when account/rateLimits/read fails", async () => {
    const { session, log } = await started(message("limits unreadable"));
    await log.turn(0);

    await expect(session.readUsageWindows()).resolves.toEqual({
      fiveHour: { percentUsed: 45, resetsAt: new Date(FAKE_FIVE_HOUR_RESET * 1000) },
      sevenDay: { percentUsed: 31, resetsAt: new Date(FAKE_SEVEN_DAY_RESET * 1000) },
      source: "rate-limit-headers",
    });
  });

  it("ends a turn refused for a used-up window as such, naming the window and its reset", async () => {
    const { log } = await started(message("used up"));

    expect(await log.turn(0)).toMatchObject({
      outcome: "usage-window-used-up",
      errors: ["You've hit your usage limit."],
      usedUpWindow: {
        window: "five-hour",
        resetsAt: new Date(FAKE_FIVE_HOUR_RESET * 1000),
        resetGiven: true,
      },
    });
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "rate-limit", status: "rejected", window: "five-hour" }),
    );
  });

  it("keeps the thread in the session's folder, written whole, and resumes on it", async () => {
    const engine = engineOn();
    const { id, session, log } = await started(message("answer hi"), {}, engine);
    await log.turn(0);
    await session.end();

    const sessionFolder = join(officeData, "sessions", id);
    expect(await readdir(sessionFolder)).toEqual(["codex-thread.json"]);
    expect(JSON.parse(await readFile(join(sessionFolder, "codex-thread.json"), "utf8"))).toEqual({
      threadId: "thread-1",
    });

    const resumed = await engine.resume(id, options());
    sessions.push(resumed);
    const resumedLog = reading(resumed);
    const after = message("answer again");
    resumed.send(after, "next");
    expect(await resumedLog.turn(0)).toMatchObject({
      outcome: "completed",
      consumedMessageIds: [after.id],
    });
    const runs = await fakeAppServerRuns(report);
    expect(runs[1]?.received.map(({ method }) => method).slice(0, 4)).toEqual([
      "initialize",
      "initialized",
      "thread/resume",
      "turn/start",
    ]);
    expect(runs[1]?.received[2]?.params).toMatchObject({ threadId: "thread-1", cwd: folder });
  });

  it("refuses to resume a session that kept no thread", async () => {
    await expect(engineOn().resume(randomUUID(), options())).rejects.toBeInstanceOf(
      CodexThreadMissing,
    );
  });

  it("steers a message sent with priority next into the running turn, which names it as taken", async () => {
    const brief = message("hold");
    const { session, log } = await started(brief);
    await turnStarted();

    const next = message("Also say extra.");
    session.send(next, "next");

    expect(await log.turn(0)).toMatchObject({
      outcome: "completed",
      consumedMessageIds: [brief.id, next.id],
    });
    const [run] = await fakeAppServerRuns(report);
    expect(run?.received.find(({ method }) => method === "turn/steer")?.params).toMatchObject({
      threadId: "thread-1",
      expectedTurnId: expect.stringMatching(/^turn-/),
      input: [{ type: "text", text: "Also say extra." }],
    });
  });

  it("holds a message sent with priority later until the turn ends, then starts a turn on it", async () => {
    const brief = message("slow");
    const { session, log } = await started(brief);
    const later = message("answer later");
    session.send(later, "later");

    expect(await log.turn(0)).toMatchObject({ consumedMessageIds: [brief.id] });
    expect(await log.turn(1)).toMatchObject({
      outcome: "completed",
      consumedMessageIds: [later.id],
    });
  });

  it("interrupts the turn, ends the app-server with what it runs, and resumes the thread on the next message", async () => {
    const { session, log } = await started(message("hold"));
    await turnStarted();

    await session.interrupt();
    expect(await log.turn(0)).toMatchObject({ outcome: "interrupted" });
    const [first] = await fakeAppServerRuns(report);
    expect(first?.received.map(({ method }) => method)).toContain("turn/interrupt");
    expect(isRunning(first?.processId ?? 0)).toBe(false);

    const after = message("answer back");
    session.send(after, "next");
    expect(await log.turn(1)).toMatchObject({
      outcome: "completed",
      consumedMessageIds: [after.id],
    });
    const runs = await fakeAppServerRuns(report);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.received.map(({ method }) => method)).toEqual([
      "initialize",
      "initialized",
      "thread/resume",
      "turn/start",
    ]);
  });

  it("refuses a command the Office rules don't allow, tells the model why, and reports one result", async () => {
    const { log } = await started(message("run npm test"));

    expect(await log.turn(0)).toMatchObject({ outcome: "completed" });
    const call = log.events.find((event) => event.kind === "tool-call");
    expect(call).toMatchObject({ tool: "Bash", officeTool: false, input: { command: "npm test" } });
    const callId = call?.kind === "tool-call" ? call.callId : "";
    expect(log.events.filter((event) => event.kind === "tool-refused")).toEqual([
      {
        kind: "tool-refused",
        callId,
        tool: "Bash",
        reason: expect.stringContaining("Not allowed in this session"),
        refusedBy: "office-rules",
      },
    ]);
    expect(
      log.events.filter((event) => event.kind === "tool-result" && event.callId === callId),
    ).toEqual([
      expect.objectContaining({ isError: true, text: expect.stringContaining("Not allowed") }),
    ]);
    await vi.waitFor(async () => {
      const [run] = await fakeAppServerRuns(report);
      expect(run?.received.find(({ method }) => method === "turn/steer")?.params).toMatchObject({
        input: [{ type: "text", text: expect.stringMatching(/^The Office rules refused Bash: /) }],
      });
    });
  });

  it("runs a command the Office rules allow, and reports its output", async () => {
    const { log } = await started(message("run echo hi"), { profile: RUNS_ANYTHING });

    await log.turn(0);
    const call = log.events.find((event) => event.kind === "tool-call");
    expect(call).toMatchObject({ tool: "Bash", input: { command: "echo hi" } });
    expect(log.events.filter((event) => event.kind === "tool-result")).toMatchObject([
      { callId: call?.kind === "tool-call" ? call.callId : "", text: "ran\n", isError: false },
    ]);
    expect(log.events.some((event) => event.kind === "tool-refused")).toBe(false);
  });

  it("ends a turn in the output its answer gives in the session's output schema, and fails one whose answer doesn't fit", async () => {
    const fits = await started(message('answer {"word":"ready"}'), { outputSchema: WORD_SCHEMA });
    expect(await fits.log.turn(0)).toMatchObject({
      outcome: "completed",
      output: { word: "ready" },
    });
    const [run] = await fakeAppServerRuns(report);
    expect(run?.received.find(({ method }) => method === "turn/start")?.params).toMatchObject({
      outputSchema: WORD_SCHEMA,
      effort: "low",
    });

    const doesnt = await started(message("answer ready"), { outputSchema: WORD_SCHEMA });
    const turn = await doesnt.log.turn(0);
    expect(turn).toMatchObject({ outcome: "failed", output: undefined });
    expect(turn.errors).toEqual([expect.stringContaining("isn't JSON")]);
  });

  it("fails the session's events when the app-server exits by itself", async () => {
    const { session, log } = await started(message("crash"));

    await expect(log.finished).rejects.toThrow(/exited with 7/);
    await session.end();
  });

  it("refuses a model the engine doesn't offer, another kind of engine and a session without exactly its skills, before any app-server starts", async () => {
    const engine = engineOn();
    const start = (overrides: Partial<SessionOptions>) =>
      engine.start({ id: randomUUID(), options: options(overrides), brief: message("hi") });

    await expect(start({ model: "gpt-4o" })).rejects.toBeInstanceOf(ModelNotOffered);
    await expect(
      start({
        engine: {
          id: "claude-code",
          name: "Claude Code",
          kind: "claude-code",
          defaultModel: "claude-sonnet-5-5",
          claudeCodeP: false,
        },
      }),
    ).rejects.toBeInstanceOf(ModelNotOffered);
    const skills = join(folder, "skills");
    await mkdir(skills);
    await expect(
      start({
        skills: {
          folder: skills,
          names: [],
          expected: ["office:missing"],
          userOnly: [],
          overrides: {},
        },
      }),
    ).rejects.toBeInstanceOf(SessionSkillsDiffer);
    expect(await fakeAppServerRuns(report)).toEqual([]);
  });

  it("records what went between the engine and each app-server, with what differs run to run as placeholders", async () => {
    const recorder = new CodexWireRecorder();
    const engine = engineOn({ wire: recorder.tap });
    const { session, log } = await started(message("hold"), {}, engine);
    await turnStarted();
    await session.interrupt();
    session.send(message("answer back"), "next");
    await log.turn(1);
    await session.end();

    const recorded = recorder.recorded();
    expect(recorder.startedThreads).toEqual(["thread-1"]);
    expect(new Set(recorded.map(({ process }) => process))).toEqual(new Set([1, 2]));
    const text = JSON.stringify(recorded);
    expect(text).not.toContain(folder);
    expect(text).not.toContain(officeData);
    expect(text).not.toMatch(/127\.0\.0\.1:\d+/);
    expect(recorded[0]).toMatchObject({
      process: 1,
      direction: "to-app-server",
      message: { method: "initialize" },
    });
    expect(recorded).toContainEqual(
      expect.objectContaining({
        process: 2,
        message: expect.objectContaining({
          method: "thread/resume",
          params: expect.objectContaining({ threadId: "<thread-1>", cwd: "<folder>" }),
        }),
      }),
    );
    expect(text).toContain('"turnId":"<turn-1>"');
  });
});

/*
 * These run real sessions on the engine check's signed-in folder, which cost quota, so they run
 * only when asked: OFFICE_ENGINE_TESTS=live runs the contract on it, and OFFICE_ENGINE_TESTS=record
 * also writes each scenario's recordings, the app-server's wire for a stand-in to replay
 * (`recordings/<scenario>.jsonl` here) and the session's events for the scripted engine
 * (`../scripted/recordings/codex/<scenario>.jsonl`) (apps/service/docs/testing.md).
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const LIVE_MODEL = "gpt-6-luna";
/** Signed in with `codex login --device-auth` for the engine check; nothing is made or removed in it. */
const CODEX_FOLDER =
  process.env["OFFICE_CODEX_ENGINE_FOLDER"] ??
  (currentOperatingSystem().name === "Windows" ? undefined : "/root/.codex-engine-check");
const WIRE_RECORDINGS = fileURLToPath(new URL("./recordings/", import.meta.url));
const PORT_RECORDINGS = fileURLToPath(new URL("../scripted/recordings/codex/", import.meta.url));
const LIVE_ENGINE: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: LIVE_MODEL,
  apiKey: null,
};

describe.runIf((MODE === "live" || MODE === "record") && CODEX_FOLDER !== undefined)(
  "CodexAppServerEngine on a live app-server",
  () => {
    const codexHome = CODEX_FOLDER ?? "";
    const officeData = new OfficeDataDirectory(join(tmpdir(), "office-codex-engine-data"));
    let recorder = new CodexWireRecorder();
    /** Every scenario's, so a scenario that failed before its end leaves no thread either. */
    const recorders: CodexWireRecorder[] = [];
    const saved = new Set<string>();

    afterAll(async () => {
      // A scenario's wire not recorded, as it failed, for reading why, outside the recordings.
      for (const [index, unsaved] of recorders.entries()) {
        if (MODE !== "record" || unsaved.saved) continue;
        const file = join(tmpdir(), `codex-unsaved-${index + 1}.jsonl`);
        await unsaved.save(file);
        console.warn(`A scenario's wire that wasn't recorded is in ${file}.`);
      }
      await deleteThreads(
        codexHome,
        recorders.flatMap((one) => one.startedThreads),
      );
    }, 60_000);

    describeAgentEngineContract("CodexAppServerEngine", {
      capabilities: CODEX_CAPABILITIES,
      engine: LIVE_ENGINE,
      // The recordings' account is on ChatGPT Free, whose one window is 30 days.
      fiveHourAndSevenDayWindows: false,
      model: LIVE_MODEL,
      timeoutMs: 180_000,
      mcpServer: CONTRACT_MCP_SERVER,
      backgroundCommands: false,
      engineFor: () => {
        recorder = new CodexWireRecorder();
        recorders.push(recorder);
        const engine = new CodexAppServerEngine(officeData, new SdkMcpClient(), {
          codexHome,
          wire: recorder.tap,
        });
        return Promise.resolve(MODE === "record" ? new RecordingEngine(engine) : engine);
      },
      afterScenario: async (scenario, engine) => {
        // A check of a missing capability runs on `reply` too; the reply's own recording stays.
        if (engine instanceof RecordingEngine && !saved.has(scenario)) {
          saved.add(scenario);
          await recorder.save(join(WIRE_RECORDINGS, `${scenario}.jsonl`));
          await mkdir(PORT_RECORDINGS, { recursive: true });
          await engine.save(join(PORT_RECORDINGS, `${scenario}.jsonl`));
        }
      },
    });
  },
);

/**
 * The contract in the default run, with no model call: each scenario on a stand-in replaying its
 * wire recording, which checks every message the engine sends against it and makes the recorded
 * MCP tool calls on the session's endpoint for real.
 */
describe("CodexAppServerEngine on a stand-in replaying the recordings", () => {
  const officeData = new OfficeDataDirectory(join(tmpdir(), `office-codex-replay-${randomUUID()}`));
  /** Each scenario's state folder, where the stand-in counts its starts, by the engine run in it. */
  const stateFolders = new Map<AgentEngine, string>();

  afterAll(async () => {
    await Promise.all(
      [...stateFolders.values(), officeData.path].map((folder) =>
        rm(folder, { recursive: true, force: true }),
      ),
    );
  });

  describeAgentEngineContract("CodexAppServerEngine on a replaying stand-in", {
    capabilities: CODEX_CAPABILITIES,
    engine: LIVE_ENGINE,
    fiveHourAndSevenDayWindows: false,
    model: LIVE_MODEL,
    timeoutMs: 20_000,
    mcpServer: CONTRACT_MCP_SERVER,
    backgroundCommands: false,
    engineFor: async (scenario) => {
      const stateFolder = await mkdtemp(join(tmpdir(), "office-codex-replay-state-"));
      const engine = new CodexAppServerEngine(
        officeData,
        new SdkMcpClient(),
        replayingAppServer(recording(scenario), stateFolder),
      );
      stateFolders.set(engine, stateFolder);
      return engine;
    },
    afterScenario: async (scenario, engine) => {
      const unreplayed = await unreplayedAppServers(
        recording(scenario),
        stateFolders.get(engine) ?? "",
      );
      if (unreplayed.length > 0) {
        throw new Error(
          `The engine stopped before the end of app-server ${unreplayed.join(", ")} of ${scenario}.jsonl.`,
        );
      }
    },
  });

  it("stops the replay with words naming the line when the engine sends what the recording doesn't have", async () => {
    const stateFolder = await mkdtemp(join(tmpdir(), "office-codex-replay-state-"));
    const folder = await mkdtemp(join(tmpdir(), "office-codex-replay-folder-"));
    const engine = new CodexAppServerEngine(
      officeData,
      new SdkMcpClient(),
      replayingAppServer(recording("reply"), stateFolder),
    );
    stateFolders.set(engine, stateFolder);
    try {
      const session = await engine.start({
        id: randomUUID(),
        options: {
          folder,
          environment: { PATH: process.env["PATH"] ?? "" },
          engine: LIVE_ENGINE,
          model: LIVE_MODEL,
          effort: "low",
          instructions: "",
          skills: undefined,
          profile: READ_ONLY,
          officeTools: [],
          mcpServers: [],
          languageServers: [],
          outputSchema: undefined,
        },
        brief: message("Reply with the single word: steady"),
      });
      await expect(reading(session).finished).rejects.toThrow(
        /The replay of reply\.jsonl, app-server 1: line \d+: turn\/start\.input\[0\]\.text is "Reply with the single word: steady" where the recording has "Reply with the single word: ready"/,
      );
      await session.end();
      expect(await unreplayedAppServers(recording("reply"), stateFolder)).toEqual([1]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

function recording(scenario: string): string {
  return join(WIRE_RECORDINGS, `${scenario}.jsonl`);
}

/** Removes the threads a scenario started from the engine's folder, as the engine check does. */
async function deleteThreads(codexHome: string, threadIds: readonly string[]): Promise<void> {
  if (threadIds.length === 0) return;
  const os = currentOperatingSystem();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const server = CodexAppServer.start(
    os.processTrees,
    {
      command: pinnedCodexPath(os.codexBinary),
      args: codexAppServerArguments(),
      cwd: tmpdir(),
      env: codexEnvironment(environment, codexHome),
    },
    {
      notification: () => undefined,
      serverRequest: () => Promise.reject(new Error("No approval is given here.")),
    },
  );
  try {
    await server.rpc.request("initialize", {
      clientInfo: { name: "the_office_tests", title: null, version: "1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    server.rpc.notify("initialized");
    for (const threadId of threadIds) {
      await server.rpc.request("thread/delete", { threadId }).catch(() => undefined);
    }
  } finally {
    await server.close();
  }
}
