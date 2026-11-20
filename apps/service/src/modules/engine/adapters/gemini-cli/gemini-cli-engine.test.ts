import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SdkMcpClient } from "../../../../platform/mcp/sdk-mcp-client.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { GeminiApiKey } from "../../domain/gemini-api-key.js";
import type { Engine, GeminiCliEngine } from "../../domain/engines.js";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import {
  CapabilityMissing,
  ModelNotOffered,
  SessionSkillsDiffer,
} from "../../ports/agent-engine.js";
import type { EngineSession, UserMessage } from "../../ports/engine-session.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionEvent, TurnEndedEvent } from "../../ports/session-events.js";
import type { SessionOptions, SessionSkills } from "../../ports/session-options.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import { defaultEnginePromptTemplates } from "../prompt-templates/engine-prompt-templates.fixtures.js";
import {
  FAKE_GEMINI_REPORT_VARIABLE,
  fakeGeminiRuns,
  writeFakeGeminiCli,
} from "./fake-gemini-cli.fixtures.js";
import { GEMINI_CLI_CAPABILITIES } from "./gemini-cli-capabilities.js";
import { GeminiCliHeadlessEngine } from "./gemini-cli-engine.js";

const KEY = "AIza-not-a-real-key";

const ENGINE: GeminiCliEngine = {
  id: "gemini-tests",
  name: "Gemini",
  kind: "gemini-cli",
  defaultModel: "flash-lite",
  apiKey: GeminiApiKey.of(KEY),
};

const READ_ONLY = {
  edit: false,
  run: { kind: "read-only-git" },
  web: false,
  mcpTools: {},
} as const;

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
  run: ({ word }) => Promise.resolve({ text: `Noted ${String(word)}.`, isError: false }),
};

function message(text: string, extra: Partial<UserMessage> = {}): UserMessage {
  return { id: randomUUID(), text, ...extra };
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
      { timeout: 20_000, interval: 20 },
    );
    return turns()[index] as TurnEndedEvent;
  };
  return { events, finished, turn };
}

describe("GeminiCliHeadlessEngine on a fake CLI", () => {
  let officeData: string;
  let folder: string;
  let report: string;
  let entry: string;
  const sessions: EngineSession[] = [];

  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-gemini-data-"));
    folder = await mkdtemp(join(tmpdir(), "office-gemini-folder-"));
    report = join(officeData, "runs.jsonl");
    entry = await writeFakeGeminiCli(officeData);
  });

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.end()));
    await rm(officeData, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  function engine(): GeminiCliHeadlessEngine {
    return new GeminiCliHeadlessEngine(
      new OfficeDataDirectory(officeData),
      new SdkMcpClient(),
      defaultEnginePromptTemplates(),
      entry,
    );
  }

  function options(overrides: Partial<SessionOptions> = {}): SessionOptions {
    return {
      folder,
      environment: {
        PATH: process.env["PATH"] ?? "",
        [FAKE_GEMINI_REPORT_VARIABLE]: report,
        GEMINI_API_KEY: "the-users-own-key",
        GOOGLE_CLOUD_PROJECT: "the-users-project",
      },
      engine: ENGINE,
      model: "flash-lite",
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

  async function started(brief: UserMessage, overrides: Partial<SessionOptions> = {}) {
    const id = randomUUID();
    const session = await engine().start({ id, options: options(overrides), brief });
    sessions.push(session);
    return { id, session, log: reading(session) };
  }

  it("starts the session on its brief, streams the reply and counts the turn's tokens", async () => {
    const brief = message("answer hello there");
    const { id, log } = await started(brief);

    const turn = await log.turn(0);

    expect(turn).toMatchObject({
      outcome: "completed",
      consumedMessageIds: [brief.id],
      usage: { input: 60, output: 10, cacheRead: 40, cacheCreation: 0 },
      errors: [],
    });
    expect(log.events).toContainEqual({
      kind: "text",
      text: "hello there",
      withinToolCall: undefined,
    });
    const [run] = await fakeGeminiRuns(report);
    expect(run?.argv).toEqual([
      "--model",
      "flash-lite",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "yolo",
      "--session-id",
      id,
    ]);
    expect(run?.prompt).toBe("answer hello there");
  });

  it("runs the CLI in the session's own home in the engine's folder, signed in by the engine's key in its environment alone", async () => {
    const { id, log } = await started(message("answer hi"));
    await log.turn(0);

    const [run] = await fakeGeminiRuns(report);
    expect(run?.env).toMatchObject({
      GEMINI_API_KEY: KEY,
      GEMINI_CLI_HOME: join(officeData, "engines", ENGINE.id, "sessions", id),
      GEMINI_CLI_NO_RELAUNCH: "true",
      NO_BROWSER: "true",
    });
    expect(run?.env["GOOGLE_CLOUD_PROJECT"]).toBeUndefined();
    expect(run?.env["GEMINI_CLI_SYSTEM_SETTINGS_PATH"]).toBeUndefined();
    expect(run?.argv.join(" ")).not.toContain(KEY);
    expect(JSON.stringify(run?.settings)).not.toContain(KEY);
    expect(run?.settings).toMatchObject({
      security: {
        folderTrust: { enabled: false },
        environmentVariableRedaction: { enabled: true, blocked: ["GEMINI_API_KEY"] },
      },
      skills: { enabled: false },
      telemetry: { enabled: false },
    });
  });

  it("keeps the home, its settings and the channel file owner-only, and removes the channel and the instructions as the session ends", async () => {
    const { id, session, log } = await started(message("answer hi"));
    await log.turn(0);
    const sessionFolder = join(officeData, "sessions", id);
    const files = await readdir(sessionFolder);
    const channelFile = files.find((name) => name.startsWith("gemini-channel-")) ?? "";
    const home = join(officeData, "engines", ENGINE.id, "sessions", id);
    const settingsFile = join(home, ".gemini", "settings.json");
    const [instructions] = (await readdir(join(home, ".gemini"))).filter((name) =>
      name.startsWith("office-"),
    );

    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(settingsFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(sessionFolder, channelFile))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(home, ".gemini", instructions ?? ""), "utf8")).toBe("Be brief.");
    const [run] = await fakeGeminiRuns(report);
    expect(run?.settings).toMatchObject({ context: { fileName: ["GEMINI.md", instructions] } });

    await session.end();

    expect(await readdir(sessionFolder)).toEqual([]);
    expect(await readdir(join(home, ".gemini"))).toEqual(["settings.json"]);
  });

  it("resumes the session for each later turn, and a message sent during a turn waits for its end", async () => {
    const { id, session, log } = await started(message("slow first"));
    const later = message("answer second");
    const next = message("answer third");
    session.send(later, "later");
    session.send(next, "next");

    const first = await log.turn(0);
    const second = await log.turn(1);

    expect(first.outcome).toBe("completed");
    expect(second.consumedMessageIds).toEqual([later.id, next.id]);
    const runs = await fakeGeminiRuns(report);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.argv.slice(-2)).toEqual(["--resume", id]);
    expect(runs[1]?.prompt).toBe("answer second\n\nanswer third");
  });

  it("stops a turn with Stop, and the next message resumes the session", async () => {
    const { id, session, log } = await started(message("hold"));
    await vi.waitFor(async () => {
      if ((await fakeGeminiRuns(report)).length === 0) throw new Error("No run yet.");
    });

    await session.interrupt();

    expect((await log.turn(0)).outcome).toBe("interrupted");
    session.send(message("answer back"), "later");
    expect((await log.turn(1)).outcome).toBe("completed");
    const runs = await fakeGeminiRuns(report);
    expect(runs[1]?.argv.slice(-2)).toEqual(["--resume", id]);
  });

  it("resumes an ended session by its id in the same home, its settings written over", async () => {
    const { id, session: first, log: firstLog } = await started(message("answer hi"));
    await firstLog.turn(0);
    await first.end();
    const session = await engine().resume(id, options());
    sessions.push(session);
    const log = reading(session);
    session.send(message("answer again"), "later");

    await log.turn(0);

    const [firstRun, resumed] = await fakeGeminiRuns(report);
    expect(resumed?.argv.slice(-2)).toEqual(["--resume", id]);
    expect(resumed?.env["GEMINI_CLI_HOME"]).toBe(firstRun?.env["GEMINI_CLI_HOME"]);
    expect(resumed?.settings).not.toEqual(firstRun?.settings);
  });

  it("refuses a call the Office rules refuse in their words, which reach the model", async () => {
    const { log } = await started(message('call run_shell_command {"command":"touch made.txt"}'));
    await log.turn(0);

    const refused = log.events.find((event) => event.kind === "tool-refused");
    expect(refused).toMatchObject({
      kind: "tool-refused",
      tool: "Bash",
      refusedBy: "office-rules",
    });
    const [run] = await fakeGeminiRuns(report);
    const reason = refused?.kind === "tool-refused" ? refused.reason : "";
    expect(reason).not.toBe("");
    expect(run?.hooks).toEqual([
      { toolName: "run_shell_command", decision: { decision: "deny", reason } },
    ]);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-result", isError: true, text: reason }),
    );
  });

  it("refuses a tool The Office doesn't know, and a command run in the background", async () => {
    const { log } = await started(message('call web_fetch {"prompt":"https://example.com"}'));
    await log.turn(0);
    const background = await started(
      message('call run_shell_command {"command":"git status","is_background":true}'),
    );
    await background.log.turn(0);

    const [unknown, inBackground] = await fakeGeminiRuns(report);
    expect(unknown?.hooks[0]?.decision).toEqual({
      decision: "deny",
      reason: "Not available in The Office: the web_fetch tool.",
    });
    expect(inBackground?.hooks[0]?.decision.reason).toContain("can't run in the background");
  });

  it("allows a call the Office rules allow and reports it as the rules judged it", async () => {
    const { log } = await started(message('call read_file {"file_path":"README.md"}'));
    await log.turn(0);

    expect(log.events).toContainEqual({
      kind: "tool-call",
      callId: "read_file__call_1",
      tool: "Read",
      officeTool: false,
      input: { file_path: "README.md" },
      withinToolCall: undefined,
    });
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-result", text: "ran", isError: false }),
    );
  });

  it("serves the Office tools through a stdio relay, judged by the hook and again as they run", async () => {
    const { log } = await started(message('call mcp_office_note {"word":"kumquat"}'), {
      officeTools: [NOTE_TOOL],
    });
    await log.turn(0);

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-call", tool: "note", officeTool: true }),
    );
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-result", text: "Noted kumquat.", isError: false }),
    );
    const [run] = await fakeGeminiRuns(report);
    expect(run?.hooks[0]?.decision).toEqual({ decision: "allow" });
    expect(run?.tools[0]).toEqual({ server: "office", listed: ["note"] });
    const settings = run?.settings as { mcpServers: Record<string, { command: string }> };
    expect(Object.keys(settings.mcpServers)).toEqual(["office"]);
    expect(settings.mcpServers["office"]?.command).toBe(process.execPath);
  });

  it("refuses an Office tool while The Office holds every call", async () => {
    const { log } = await started(message('call mcp_office_note {"word":"kumquat"}'), {
      officeTools: [NOTE_TOOL],
      toolHold: () => Promise.resolve("The fire alarm is on."),
    });
    await log.turn(0);

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-refused", reason: "The fire alarm is on." }),
    );
  });

  it("runs the Role's MCP servers in the service, so no Server value reaches the CLI", async () => {
    const { log } = await started(
      message('call mcp_fake_environment-variable {"name":"SECRET_VALUE"}'),
      {
        profile: { ...READ_ONLY, mcpTools: { "fake/environment-variable": { kind: "allowed" } } },
        mcpServers: [
          {
            name: "fake",
            launch: CONTRACT_MCP_SERVER.launch({ SECRET_VALUE: "kumquat" }, folder),
            tools: [
              {
                name: "environment-variable",
                description: "Reads a variable.",
                inputSchema: { type: "object", properties: { name: { type: "string" } } },
              },
            ],
          },
        ],
      },
    );
    await log.turn(0);

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-call", tool: "mcp__fake__environment-variable" }),
    );
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-result", isError: false, text: "kumquat" }),
    );
    const [run] = await fakeGeminiRuns(report);
    expect(JSON.stringify(run?.settings)).not.toContain("kumquat");
    expect(JSON.stringify(run?.env)).not.toContain("kumquat");
    expect(run?.settings).toMatchObject({
      tools: { core: expect.arrayContaining(["mcp_fake_*"]) },
    });
  });

  it("takes the answer StructuredOutput was called with as the turn's output", async () => {
    const { log } = await started(message('call mcp_office_StructuredOutput {"word":"fig"}'), {
      outputSchema: WORD_SCHEMA,
    });

    const turn = await log.turn(0);

    expect(turn.outcome).toBe("completed");
    expect(turn.output).toEqual({ word: "fig" });
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-call", tool: "StructuredOutput", officeTool: false }),
    );
  });

  it("refuses an answer that doesn't fit the schema, reminds a turn twice, then fails it", async () => {
    const { log } = await started(message('call mcp_office_StructuredOutput {"word":3}'), {
      outputSchema: WORD_SCHEMA,
    });

    const turn = await log.turn(0);

    expect(turn.outcome).toBe("failed");
    expect(turn.errors[0]).toContain("without calling StructuredOutput");
    const runs = await fakeGeminiRuns(report);
    expect(runs).toHaveLength(3);
    expect(runs[1]?.prompt).toContain("mcp_office_StructuredOutput");
    expect(turn.usage.output).toBe(30);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "tool-result", isError: true, text: "/word must be string" }),
    );
  });

  it("lists exactly the session's skills in the Skill tool, loads one, and runs a skill command", async () => {
    const skills = await pluginSkills(officeData);
    const { log } = await started(message('call mcp_office_Skill {"skill":"office:review"}'), {
      skills,
    });
    await log.turn(0);

    expect(log.events).toContainEqual(
      expect.objectContaining({
        kind: "tool-call",
        tool: "Skill",
        input: { skill: "office:review" },
      }),
    );
    expect(log.events).toContainEqual(
      expect.objectContaining({
        kind: "tool-result",
        text: expect.stringContaining("Review it all."),
      }),
    );
    const commanded = await started(
      message("/office:review the diff", {
        skillCommand: { skill: "office:review", input: "the diff" },
      }),
      { skills },
    );
    await commanded.log.turn(0);
    const runs = await fakeGeminiRuns(report);
    expect(runs[0]?.tools[0]).toEqual({ server: "office", listed: ["Skill"] });
    expect(runs[1]?.prompt).toContain("Review it all.\n\nARGUMENTS: the diff");
  });

  it("refuses a session that wouldn't list exactly its skills, before any process starts", async () => {
    const skills = await pluginSkills(officeData);

    await expect(
      started(message("answer hi"), { skills: { ...skills, expected: ["office:other"] } }),
    ).rejects.toBeInstanceOf(SessionSkillsDiffer);
    expect(await fakeGeminiRuns(report)).toEqual([]);
  });

  it("reads the context from the chat the CLI keeps, against the model's window", async () => {
    const { session, log } = await started(message("answer hi"));
    await log.turn(0);
    expect(await session.readContextUsage()).toEqual({ tokens: 110, window: 1_048_576 });

    session.send(message("chat"), "later");
    await log.turn(1);

    expect(await session.readContextUsage()).toEqual({ tokens: 5300, window: 1_048_576 });
  });

  it("fails a turn the CLI fails, in its words, and takes the next message", async () => {
    const { session, log } = await started(message("fail"));

    const failed = await log.turn(0);
    session.send(message("crash"), "later");
    const crashed = await log.turn(1);

    expect(failed).toMatchObject({
      outcome: "failed",
      errors: ["429 You exceeded your current quota"],
    });
    expect(crashed.outcome).toBe("failed");
    expect(crashed.errors[0]).toContain("The CLI fell over.");
  });

  it("fails a turn in a folder holding .gemini/settings.json, which would rank above the session's settings, starting no process", async () => {
    await mkdir(join(folder, ".gemini"));
    await writeFile(join(folder, ".gemini", "settings.json"), '{"hooksConfig":{"enabled":false}}');
    const { log } = await started(message("answer hello there"));

    const turn = await log.turn(0);

    expect(turn).toMatchObject({
      outcome: "failed",
      errors: [
        `The Gemini CLI engine can't run in ${folder}: its .gemini/settings.json would rank above The Office's settings and could turn the Office rules off. Remove the file, or pick another engine for this Role.`,
      ],
    });
    expect(await fakeGeminiRuns(report)).toEqual([]);
  });

  it("runs in a folder whose .gemini/ holds other files", async () => {
    await mkdir(join(folder, ".gemini", "commands"), { recursive: true });
    await writeFile(join(folder, ".gemini", "commands", "x.toml"), 'prompt = "x"');
    const { log } = await started(message("answer hello there"));

    expect((await log.turn(0)).outcome).toBe("completed");
  });

  it("refuses a model the engine doesn't offer and another kind of engine", async () => {
    await expect(started(message("answer hi"), { model: "gemini-9" })).rejects.toBeInstanceOf(
      ModelNotOffered,
    );
    const other: Engine = { ...ENGINE, kind: "codex", apiKey: null } as unknown as Engine;
    await expect(started(message("answer hi"), { engine: other })).rejects.toBeInstanceOf(
      ModelNotOffered,
    );
  });

  it("declares the capabilities the engine check recorded and refuses the usage windows", async () => {
    const { session, log } = await started(message("answer hi"));
    await log.turn(0);

    expect(engine().capabilities).toBe(GEMINI_CLI_CAPABILITIES);
    await expect(session.readUsageWindows()).rejects.toBeInstanceOf(CapabilityMissing);
    await expect(engine().readUsageWindows()).resolves.toBeUndefined();
  });
});

/** A session's plugin folder with one skill, `office:review`, as the Skills module prepares it. */
async function pluginSkills(officeData: string): Promise<SessionSkills> {
  const skillsFolder = join(officeData, "plugin");
  await mkdir(join(skillsFolder, ".claude-plugin"), { recursive: true });
  await writeFile(join(skillsFolder, ".claude-plugin", "plugin.json"), '{"name":"office"}');
  await mkdir(join(skillsFolder, "skills", "review"), { recursive: true });
  await writeFile(
    join(skillsFolder, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Reviews.\n---\nReview it all.\n",
  );
  return {
    folder: skillsFolder,
    names: [],
    expected: ["office:review"],
    userOnly: [],
    overrides: {},
  };
}

const MODE = process.env["OFFICE_ENGINE_TESTS"];
const LIVE_KEY = process.env["GEMINI_API_KEY"];

/**
 * The AgentEngine contract on the pinned Gemini CLI with a real model, run only when asked:
 * OFFICE_ENGINE_TESTS=live with GEMINI_API_KEY set, on the cheapest model (Task c5691eeb runs it).
 */
describe.runIf(MODE === "live" && LIVE_KEY !== undefined)(
  "GeminiCliHeadlessEngine on the pinned CLI",
  () => {
    const officeData = new OfficeDataDirectory(join(tmpdir(), "office-gemini-engine-data"));
    describeAgentEngineContract("GeminiCliHeadlessEngine", {
      capabilities: GEMINI_CLI_CAPABILITIES,
      engine: { ...ENGINE, id: "gemini-cli", apiKey: GeminiApiKey.of(LIVE_KEY ?? "unset") },
      model: "flash-lite",
      timeoutMs: 180_000,
      mcpServer: CONTRACT_MCP_SERVER,
      backgroundCommands: false,
      fiveHourAndSevenDayWindows: false,
      engineFor: () =>
        Promise.resolve(
          new GeminiCliHeadlessEngine(
            officeData,
            new SdkMcpClient(),
            defaultEnginePromptTemplates(),
          ),
        ),
    });
  },
);
