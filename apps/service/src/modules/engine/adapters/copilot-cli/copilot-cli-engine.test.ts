import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { CopilotCliToken } from "../../domain/copilot-cli-token.js";
import {
  COPILOT_CLI_AUTO_MODEL,
  type CodexEngine,
  type CopilotCliEngine,
} from "../../domain/engines.js";
import {
  describeAgentEngineContract,
  SESSIONLESS_SCENARIOS,
} from "../../ports/agent-engine.contract.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import { RecordingEngine } from "../scripted/recording-engine.js";
import { CopilotRecorder, CopilotReplay } from "./copilot-recording.fixtures.js";
import { sdkCopilotSessions } from "./sdk-copilot-sessions.js";
import {
  CapabilityMissing,
  ModelNotOffered,
  SessionSkillsDiffer,
  type AgentEngine,
} from "../../ports/agent-engine.js";
import type { EngineSession, UserMessage } from "../../ports/engine-session.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionEvent, ToolCallEvent, TurnEndedEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { COPILOT_CLI_CAPABILITIES, CopilotSdkEngine } from "./copilot-cli-engine.js";
import { StandInCopilotRuntime } from "./copilot-runtime.fixtures.js";

const TOKEN = "github_pat_for_the_tests_only";

const ENGINE: CopilotCliEngine = {
  id: "copilot-tests",
  name: "Copilot",
  kind: "copilot-cli",
  defaultModel: "auto",
  defaultEffort: null,
  token: CopilotCliToken.of(TOKEN),
};

const EDITS = {
  edit: true,
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
  run: () => Promise.resolve({ text: "Noted.", isError: false }),
};

function message(text: string): UserMessage {
  return { id: randomUUID(), text };
}

/** Reads a session's events as they come. */
function reading(session: EngineSession, timeout = 5_000) {
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
      { timeout, interval: 10 },
    );
    return turns()[index] as TurnEndedEvent;
  };
  return { events, finished, turn };
}

/** A promise the test settles, as a long command's end. */
function gate(): { readonly until: Promise<void>; open(): void } {
  let open!: () => void;
  const until = new Promise<void>((resolve) => (open = resolve));
  return { until, open };
}

describe("CopilotSdkEngine on a stand-in runtime", () => {
  let officeData: string;
  let folder: string;
  let runtime: StandInCopilotRuntime;
  const sessions: EngineSession[] = [];

  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-copilot-data-"));
    folder = await mkdtemp(join(tmpdir(), "office-copilot-folder-"));
    runtime = new StandInCopilotRuntime();
  });

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.end()));
    await rm(officeData, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  function engine(): CopilotSdkEngine {
    return new CopilotSdkEngine(new OfficeDataDirectory(officeData), runtime.open);
  }

  function options(overrides: Partial<SessionOptions> = {}): SessionOptions {
    return {
      folder,
      environment: {
        PATH: process.env["PATH"] ?? "",
        COPILOT_GITHUB_TOKEN: "not-for-the-runtime",
        GH_TOKEN: "not-for-the-runtime",
        GITHUB_TOKEN: "not-for-the-runtime",
        PROJECT_SETTING: "kept",
      },
      engine: ENGINE,
      model: "auto",
      effort: "low",
      instructions: "Be brief.",
      skills: undefined,
      profile: EDITS,
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

  describe("the runtime it starts", () => {
    it("runs on the engine's folder, signed in by the engine's token alone", async () => {
      const home = join(officeData, "engines", ENGINE.id);
      await mkdir(home, { recursive: true });
      await writeFile(join(home, "mcp-config.json"), '{"mcpServers":{"home":{}}}');

      const { id, log } = await started(message("Begin."));
      await log.turn(0);

      const [spec] = runtime.specs;
      expect(spec).toMatchObject({
        sessionId: id,
        resume: false,
        home,
        token: TOKEN,
        workingDirectory: folder,
        instructions: "Be brief.",
        skillDirectories: [],
        mcpServers: {},
      });
      // Auto names no model, so the runtime chooses.
      expect(spec?.model).toBeUndefined();
      expect(spec?.environment["PROJECT_SETTING"]).toBe("kept");
      expect(spec?.environment["COPILOT_TELEMETRY_DISABLED"]).toBe("true");
      const variables = Object.keys(spec?.environment ?? {});
      expect(
        variables.filter((name) => /^(COPILOT(?!_TELEMETRY_DISABLED)|GH_|GITHUB_)/.test(name)),
      ).toEqual([]);
      expect(Object.values(spec?.environment ?? {})).not.toContain(TOKEN);
      expect(existsSync(join(home, "mcp-config.json"))).toBe(false);
    });

    it("leaves the token out when the engine keeps none, for the folder's own sign-in", async () => {
      const { log } = await started(message("Begin."), { engine: { ...ENGINE, token: null } });
      await log.turn(0);

      expect(runtime.specs[0]?.token).toBeUndefined();
    });

    it("offers the judged tools, the Office tools and each MCP tool by its runtime name, never a Sub-agent's", async () => {
      const { log } = await started(message("Begin."), {
        officeTools: [NOTE_TOOL],
        mcpServers: [
          {
            name: "docs",
            launch: {
              transport: "stdio",
              command: "docs-server",
              arguments: ["--quiet"],
              environmentVariables: { DOCS_KEY: "a secret" },
              workingFolder: folder,
            },
            tools: [{ name: "search", description: "Searches.", inputSchema: {} }],
          },
          {
            name: "remote",
            launch: {
              transport: "streamable-http",
              url: "https://mcp.example.com/",
              headers: { Authorization: "Bearer a secret" },
            },
            tools: [{ name: "fetch", description: "Fetches.", inputSchema: {} }],
          },
        ],
      });
      await log.turn(0);

      const spec = runtime.specs[0];
      expect(spec?.availableTools).toEqual(
        expect.arrayContaining([
          "bash",
          "view",
          "glob",
          "grep",
          "rg",
          "create",
          "edit",
          "apply_patch",
          "web_fetch",
          "read_bash",
          "note",
          "docs-search",
          "remote-fetch",
        ]),
      );
      expect(spec?.availableTools).not.toContain("task");
      expect(spec?.availableTools.filter((tool) => tool.endsWith("_agent"))).toEqual([]);
      // No skills, so no skill tool.
      expect(spec?.availableTools).not.toContain("skill");
      expect(spec?.mcpServers).toEqual({
        docs: {
          type: "stdio",
          command: "docs-server",
          args: ["--quiet"],
          env: { DOCS_KEY: "a secret" },
          workingDirectory: folder,
          tools: ["search"],
        },
        remote: {
          type: "http",
          url: "https://mcp.example.com/",
          headers: { Authorization: "Bearer a secret" },
          tools: ["fetch"],
        },
      });
      expect(spec?.officeTools.map(({ name }) => name)).toEqual(["note"]);
      expect(spec?.officeTools[0]?.parameters).toMatchObject({
        type: "object",
        properties: { word: { type: "string" } },
      });
    });

    it("resumes the same session id in a new runtime", async () => {
      const id = randomUUID();
      const session = await engine().resume(id, options());
      sessions.push(session);

      expect(runtime.specs[0]).toMatchObject({ sessionId: id, resume: true });
      expect(runtime.sent).toEqual([]);
    });

    it("refuses another engine kind or a model the engine doesn't offer, before the runtime starts", async () => {
      const codex: CodexEngine = {
        id: "codex",
        name: "Codex",
        kind: "codex",
        defaultModel: "gpt-6-luna",
        defaultEffort: null,
        apiKey: null,
      };
      await expect(
        engine().start({ id: "s-1", options: options({ engine: codex }), brief: message("Hi.") }),
      ).rejects.toThrow(ModelNotOffered);
      await expect(engine().resume("s-2", options({ model: "gpt-5-mini" }))).rejects.toThrow(
        ModelNotOffered,
      );
      expect(runtime.specs).toEqual([]);
    });

    it("keeps the bundled skills out and refuses a session the runtime lists other skills for", async () => {
      const skillsFolder = join(officeData, "session-skills");
      runtime.skills = [
        { name: "review", path: join(skillsFolder, "skills", "review", "SKILL.md"), enabled: true },
        { name: "pr-stack", path: "/bundled/pr-stack/SKILL.md", enabled: true },
      ];
      const skills = {
        folder: skillsFolder,
        names: ["office:review"],
        expected: ["office:review"],
        userOnly: [],
        overrides: {},
      };

      await expect(
        engine().start({ id: "s-1", options: options({ skills }), brief: message("Hi.") }),
      ).rejects.toThrow(SessionSkillsDiffer);
      const spec = runtime.specs[0];
      expect(spec?.skillDirectories).toEqual([join(skillsFolder, "skills")]);
      expect(spec?.disabledSkills).toEqual(
        expect.arrayContaining(["pr-stack", "github-pr-media", "customize-cloud-agent"]),
      );
      expect(spec?.availableTools).toContain("skill");
      expect(runtime.closes).toBe(1);
      expect(runtime.sent).toEqual([]);

      runtime.skills = runtime.skills.slice(0, 1);
      const { log } = await started(message("Begin."), { skills });
      await log.turn(0);
    });

    it("runs a skill command as the runtime names the skill", async () => {
      const skillsFolder = join(officeData, "session-skills");
      runtime.skills = [
        { name: "review", path: join(skillsFolder, "skills", "review", "SKILL.md"), enabled: true },
      ];
      const skills = {
        folder: skillsFolder,
        names: ["office:review"],
        expected: ["office:review"],
        userOnly: [],
        overrides: {},
      };

      const { log } = await started(
        {
          ...message("/office:review the patch"),
          skillCommand: { skill: "office:review", input: "the patch" },
        },
        { skills },
      );
      await log.turn(0);

      expect(runtime.sent[0]?.prompt).toBe("/review the patch");
    });
  });

  describe("the pre-tool-use hook", () => {
    it("allows a read in the worktree and approves only the permission requests of calls it allowed", async () => {
      const { log } = await started(message("Begin."));
      await log.turn(0);

      expect(await runtime.ask("view", "call-1", { path: join(folder, "a.ts") })).toEqual({
        allowed: true,
      });
      expect(runtime.permission("call-1")).toBe(true);
      expect(runtime.permission("call-2")).toBe(false);
      expect(runtime.permission(undefined)).toBe(false);
    });

    it("refuses a write outside the worktree in the rules' words, reported as the Office rules'", async () => {
      const { log } = await started(message("Begin."));
      await log.turn(0);

      const decision = await runtime.ask("create", "call-1", {
        path: join(officeData, "outside.txt"),
        file_text: "no",
      });

      expect(decision.allowed).toBe(false);
      expect(log.events).toContainEqual({
        kind: "tool-refused",
        callId: "call-1",
        tool: "Write",
        reason: decision.allowed ? "" : decision.reason,
        refusedBy: "office-rules",
      });
      expect(runtime.permission("call-1")).toBe(false);
    });

    it("refuses an unknown tool and the tool that starts a Sub-agent", async () => {
      const { log } = await started(message("Begin."));
      await log.turn(0);

      expect(await runtime.ask("teleport", "call-1", {})).toEqual({
        allowed: false,
        reason: "Not available in The Office: the teleport tool.",
      });
      const task = await runtime.ask("task", "call-2", { agent_type: "explore", prompt: "Look." });
      expect(task.allowed).toBe(false);
      expect(log.events.filter((event) => event.kind === "tool-refused")).toEqual([
        expect.objectContaining({ callId: "call-1", tool: "teleport" }),
        expect.objectContaining({ callId: "call-2", tool: "task" }),
      ]);
    });

    it("refuses every call in the hold's words while The Office holds them", async () => {
      const toolHold = vi
        .fn<() => Promise<string | undefined>>()
        .mockResolvedValue("The fire alarm is on.");
      const { log } = await started(message("Begin."), { toolHold });
      await log.turn(0);

      expect(await runtime.ask("view", "call-1", { path: join(folder, "a.ts") })).toEqual({
        allowed: false,
        reason: "The fire alarm is on.",
      });
    });

    it("refuses a call it fails to judge", async () => {
      const toolHold = vi
        .fn<() => Promise<string | undefined>>()
        .mockRejectedValue(new Error("the hold broke"));
      const { log } = await started(message("Begin."), { toolHold });
      await log.turn(0);

      const decision = await runtime.ask("view", "call-1", { path: join(folder, "a.ts") });

      expect(decision).toEqual({
        allowed: false,
        reason: "Refused by The Office: it could not judge this call (the hold broke).",
      });
    });

    it("keeps a refused file unwritten, and the session takes its next turn", async () => {
      const outside = join(officeData, "refused.txt");
      runtime.turns = [
        [
          {
            kind: "tool",
            toolCallId: "call-1",
            toolName: "create",
            args: { path: outside, file_text: "no" },
            run: async () => {
              await writeFile(outside, "no");
              return "Created.";
            },
          },
        ],
        [{ kind: "answer", content: "Second turn." }],
      ];
      const { session, log } = await started(message("Write it."));

      const first = await log.turn(0);
      session.send(message("Go on."), "later");
      const second = await log.turn(1);

      expect(existsSync(outside)).toBe(false);
      expect(first.outcome).toBe("completed");
      expect(second.outcome).toBe("completed");
      const kinds = log.events
        .filter((event) => "callId" in event && event.callId === "call-1")
        .map((event) => event.kind);
      expect(kinds).toEqual(["tool-call", "tool-refused", "tool-result"]);
      expect(log.events).toContainEqual(
        expect.objectContaining({ kind: "text", text: "Second turn." }),
      );
    });

    it("judges an Office tool again as it runs", async () => {
      const toolHold = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);
      const { log } = await started(message("Begin."), { officeTools: [NOTE_TOOL], toolHold });
      await log.turn(0);
      const note = runtime.specs[0]?.officeTools[0];

      expect(await note?.answer({ word: "hi" }, "call-1")).toBe("Noted.");
      toolHold.mockResolvedValue("The fire alarm is on.");
      await expect(note?.answer({ word: "hi" }, "call-2")).rejects.toThrow("The fire alarm is on.");
    });
  });

  describe("messages", () => {
    it("sends the brief to start a turn with the output schema, and names it in the turn's end", async () => {
      runtime.turns = [[{ kind: "answer", content: '{"word":"hi"}' }]];
      const brief = message("Begin.");
      const { log } = await started(brief, { outputSchema: WORD_SCHEMA });

      const ended = await log.turn(0);

      expect(runtime.sent[0]).toMatchObject({
        prompt: "Begin.",
        mode: "enqueue",
        responseSchema: WORD_SCHEMA,
        clientTurnId: brief.id,
      });
      expect(ended.consumedMessageIds).toEqual([brief.id]);
    });

    it("steers a next message into the running turn without the schema, and holds later ones for a turn of their own", async () => {
      const held = gate();
      const heldNext = gate();
      runtime.turns = [
        [{ kind: "wait", until: held.until }],
        [{ kind: "wait", until: heldNext.until }],
      ];
      const brief = message("Begin.");
      const { session, log } = await started(brief, { outputSchema: WORD_SCHEMA });
      await vi.waitFor(() => expect(runtime.sent).toHaveLength(1));

      const next = message("Now this.");
      const later = message("Then this.");
      const after = message("And this.");
      session.send(next, "next");
      session.send(later, "later");
      session.send(after, "later");
      await vi.waitFor(() => expect(runtime.sent).toHaveLength(2));
      held.open();
      const ended = await log.turn(0);
      await vi.waitFor(() => expect(runtime.sent).toHaveLength(4));
      heldNext.open();
      const following = await log.turn(1);

      expect(runtime.sent[1]).toMatchObject({
        mode: "immediate",
        responseSchema: undefined,
        clientTurnId: next.id,
      });
      expect(runtime.sent.slice(2)).toMatchObject([
        { mode: "enqueue", responseSchema: WORD_SCHEMA, clientTurnId: later.id },
        { mode: "enqueue", responseSchema: WORD_SCHEMA, clientTurnId: after.id },
      ]);
      expect(ended.consumedMessageIds).toEqual([brief.id, next.id]);
      expect(following.consumedMessageIds).toEqual([later.id, after.id]);
    });

    it("sends a message as enqueue once the turn has ended, whatever its priority", async () => {
      const { session, log } = await started(message("Begin."));
      await log.turn(0);

      session.send(message("Again."), "next");
      await log.turn(1);

      expect(runtime.sent[1]?.mode).toBe("enqueue");
    });

    it("gives an image as a blob", async () => {
      const brief: UserMessage = {
        ...message("What colour?"),
        images: [
          {
            attachmentId: "a-1",
            name: "red.png",
            mediaType: "image/png",
            content: new Uint8Array([1, 2, 3]),
          },
        ],
      };
      const { log } = await started(brief);
      await log.turn(0);

      expect(runtime.sent[0]?.attachments).toEqual([
        { type: "blob", data: "AQID", mimeType: "image/png", displayName: "red.png" },
      ]);
    });
  });

  describe("Stop, readings and the end", () => {
    it("aborts the running turn and returns once it ended interrupted; the next turn runs", async () => {
      runtime.turns = [[{ kind: "wait", until: new Promise(() => undefined) }]];
      const { session, log } = await started(message("Run it."));
      await vi.waitFor(() => expect(runtime.sent).toHaveLength(1));

      await session.interrupt();

      expect(runtime.aborts).toBe(1);
      expect((await log.turn(0)).outcome).toBe("interrupted");
      session.send(message("Again."), "later");
      expect((await log.turn(1)).outcome).toBe("completed");
    });

    it("reads the context from the runtime's usage info and has no usage windows", async () => {
      const { session, log } = await started(message("Begin."));
      await log.turn(0);

      expect(await session.readContextUsage()).toEqual({ tokens: 110, window: 128_000 });
      await expect(session.readUsageWindows()).rejects.toThrow(CapabilityMissing);
      const adapter: AgentEngine = engine();
      await expect(
        adapter.readUsageWindows(ENGINE, new AbortController().signal),
      ).resolves.toBeUndefined();
    });

    it("closes the runtime and finishes the events as it ends", async () => {
      const { session, log } = await started(message("Begin."));
      await log.turn(0);

      await session.end();
      await log.finished;

      expect(runtime.closes).toBe(1);
    });

    it("fails the session when the runtime ends by itself", async () => {
      const { log } = await started(message("Begin."));
      await log.turn(0);

      runtime.exit("The Copilot CLI runtime ended by itself (SIGKILL).");

      await expect(log.finished).rejects.toThrow("ended by itself");
      await vi.waitFor(() => expect(runtime.closes).toBe(1));
    });
  });

  it("declares what the engine check showed", () => {
    expect(COPILOT_CLI_CAPABILITIES).toEqual({
      bargeIn: true,
      interrupt: true,
      resume: true,
      usageWindows: false,
      contextUsage: true,
      officeTools: true,
      outputSchema: true,
      languageServers: false,
      carrySession: false,
      startsUsageWindow: false,
    });
  });
});

/*
 * These run real sessions on a live runtime, signed in by the token in `COPILOT_GITHUB_TOKEN`,
 * which cost premium requests, so they run only when asked: OFFICE_ENGINE_TESTS=live runs the
 * contract and the scenarios below on it, and OFFICE_ENGINE_TESTS=record also writes each
 * scenario's recording, what went between the session and its runtimes for a stand-in to replay
 * (`recordings/<scenario>.jsonl` here), and the session's events for the scripted engine
 * (`../scripted/recordings/copilot-cli/<scenario>.jsonl`) (apps/service/docs/testing.md).
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const LIVE_TOKEN = process.env["COPILOT_GITHUB_TOKEN"];
const RUNTIME_RECORDINGS = fileURLToPath(new URL("./recordings/", import.meta.url));
const PORT_RECORDINGS = fileURLToPath(
  new URL("../scripted/recordings/copilot-cli/", import.meta.url),
);
/** Auto, the cheapest route: the token's account refuses any model named (docs/engine-check.md). */
const LIVE_MODEL = COPILOT_CLI_AUTO_MODEL;

function liveEngine(token: CopilotCliToken | null): CopilotCliEngine {
  return {
    id: "copilot-cli",
    name: "Copilot",
    kind: "copilot-cli",
    defaultModel: LIVE_MODEL,
    defaultEffort: null,
    token,
  };
}

const READ_ONLY = {
  edit: false,
  run: { kind: "read-only-git" },
  web: false,
  mcpTools: {},
} as const;
const RUNS_ANYTHING = { edit: true, run: { kind: "anything" }, web: false, mcpTools: {} } as const;

/** Why the Office rules refuse an edit to a session whose profile has none. */
const EDIT_REFUSAL = "Not allowed in this session: editing files.";
const LEDGER_CLOSED = "The ledger is closed for the day.";

function scenarioOptions(
  folder: string,
  engine: CopilotCliEngine,
  overrides: Partial<SessionOptions> = {},
): SessionOptions {
  return {
    folder,
    environment: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
    engine,
    model: LIVE_MODEL,
    effort: "low",
    instructions: "",
    skills: undefined,
    profile: READ_ONLY,
    officeTools: [],
    mcpServers: [],
    languageServers: [],
    outputSchema: undefined,
    ...overrides,
  };
}

/** A scenario of this engine's own beside the contract's, recorded and replayed as they are. */
interface EngineScenario {
  readonly name: string;
  readonly title: string;
  run(
    engine: AgentEngine,
    folder: string,
    copilot: CopilotCliEngine,
    timeout: number,
  ): Promise<void>;
}

const ENGINE_SCENARIOS: readonly EngineScenario[] = [
  {
    name: "refused-write",
    title: "keeps a file the Office rules refuse unwritten, and the session takes its next turn",
    run: async (engine, folder, copilot, timeout) => {
      const session = await engine.start({
        id: randomUUID(),
        options: scenarioOptions(folder, copilot),
        brief: message(
          "Create the file notes.txt containing the word hi, with your tool for writing files. " +
            "If that is refused, do not try again or another way; reply with the single word: refused",
        ),
      });
      const log = reading(session, timeout);
      expect((await log.turn(0)).outcome).toBe("completed");
      const refusal = log.events.find((event) => event.kind === "tool-refused");
      expect(refusal).toMatchObject({ refusedBy: "office-rules", reason: EDIT_REFUSAL });
      expect(existsSync(join(folder, "notes.txt"))).toBe(false);

      const next = message("Reply with the single word: next");
      session.send(next, "later");
      const turn = await log.turn(1);
      expect(turn).toMatchObject({ outcome: "completed", consumedMessageIds: [next.id] });
      expect(existsSync(join(folder, "notes.txt"))).toBe(false);
      await session.end();
      await log.finished;
    },
  },
  {
    name: "office-tool-error",
    title: "gives the Agent an Office tool's error as a failed result, and the turn goes on",
    run: async (engine, folder, copilot, timeout) => {
      const ledger: OfficeTool = {
        name: "ledger",
        description: "Notes a word in The Office's ledger.",
        input: z.object({ word: z.string() }),
        run: () => Promise.resolve({ text: LEDGER_CLOSED, isError: true }),
      };
      const session = await engine.start({
        id: randomUUID(),
        options: scenarioOptions(folder, copilot, { officeTools: [ledger] }),
        brief: message(
          'Call the ledger tool once with the word "tangerine". Whatever it answers, do not call it ' +
            "again; reply with the single word: done",
        ),
      });
      const log = reading(session, timeout);
      expect((await log.turn(0)).outcome).toBe("completed");
      const call = log.events.find(
        (event): event is ToolCallEvent =>
          event.kind === "tool-call" && event.officeTool && event.tool === ledger.name,
      );
      expect(call).toBeDefined();
      const result = log.events.find(
        (event) => event.kind === "tool-result" && event.callId === call?.callId,
      );
      expect(result).toMatchObject({ isError: true, text: expect.stringContaining(LEDGER_CLOSED) });
      await session.end();
    },
  },
];

describe.runIf((MODE === "live" || MODE === "record") && LIVE_TOKEN !== undefined)(
  "CopilotSdkEngine on a live runtime",
  () => {
    const token = liveToken(LIVE_TOKEN ?? "");
    const engine = liveEngine(token);
    const officeData = new OfficeDataDirectory(join(tmpdir(), "office-copilot-engine-data"));
    const processTrees = currentOperatingSystem().processTrees;
    let recorder = new CopilotRecorder(sdkCopilotSessions(processTrees));
    const recorders: CopilotRecorder[] = [];
    const saved = new Set<string>();
    const recordedUsage: string[] = [];

    function freshEngine(): AgentEngine {
      recorder = new CopilotRecorder(sdkCopilotSessions(processTrees));
      recorders.push(recorder);
      const copilot = new CopilotSdkEngine(officeData, recorder.tap);
      return MODE === "record" ? new RecordingEngine(copilot) : copilot;
    }

    async function keep(scenario: string, used: AgentEngine): Promise<void> {
      recordedUsage.push(`${scenario}: ${usageOf(recorder.text())}`);
      if (MODE !== "record" || saved.has(scenario)) return;
      saved.add(scenario);
      await recorder.save(join(RUNTIME_RECORDINGS, `${scenario}.jsonl`));
      if (used instanceof RecordingEngine) {
        await mkdir(PORT_RECORDINGS, { recursive: true });
        await used.save(join(PORT_RECORDINGS, `${scenario}.jsonl`));
      }
    }

    afterAll(async () => {
      console.info(`Copilot CLI usage by scenario:\n${recordedUsage.join("\n")}`);
      for (const [index, unsaved] of recorders.entries()) {
        if (MODE !== "record" || unsaved.saved) continue;
        const file = join(tmpdir(), `copilot-unsaved-${index + 1}.jsonl`);
        await unsaved.save(file).catch(() => undefined);
        console.warn(`A scenario that wasn't recorded is in ${file}.`);
      }
      // Nothing the runtime wrote in the engine's folder holds the token.
      const holding = await filesHolding(officeData.path, token.reveal());
      if (holding.length > 0) throw new Error(`The token is in ${holding.join(", ")}.`);
    }, 60_000);

    describeAgentEngineContract("CopilotSdkEngine", {
      capabilities: COPILOT_CLI_CAPABILITIES,
      engine,
      model: LIVE_MODEL,
      timeoutMs: 180_000,
      mcpServer: CONTRACT_MCP_SERVER,
      backgroundCommands: false,
      engineFor: () => Promise.resolve(freshEngine()),
      afterScenario: async (scenario, used) => {
        // A check of a missing capability runs on `reply` too; the reply's own recording stays.
        if (!SESSIONLESS_SCENARIOS.includes(scenario)) await keep(scenario, used);
      },
    });

    describe("its own scenarios", () => {
      let folder: string;
      beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), "office-engine-"));
      });
      afterEach(async () => {
        await rm(folder, { recursive: true, force: true });
      });

      it.each(ENGINE_SCENARIOS)(
        "$title",
        async (scenario) => {
          const used = freshEngine();
          await expect(scenario.run(used, folder, engine, 120_000)).resolves.toBeUndefined();
          await keep(scenario.name, used);
        },
        180_000,
      );

      it("ends a shell command's processes on Stop, and a detached one's as the session ends", async () => {
        const session = await freshEngine().start({
          id: randomUUID(),
          options: scenarioOptions(folder, engine, { profile: RUNS_ANYTHING }),
          brief: message(
            "Run this exact command with your shell tool, in the foreground, and wait for it: " +
              "sh -c 'echo $$ > fg.pid; exec sleep 120'\nThen reply with the single word: slept",
          ),
        });
        const log = reading(session, 120_000);
        const foreground = await pidIn(join(folder, "fg.pid"));
        await session.interrupt();
        expect((await log.turn(0)).outcome).toBe("interrupted");
        await vi.waitFor(() => expect(isRunning(foreground)).toBe(false), { timeout: 10_000 });

        session.send(
          message(
            "Start this exact command with your shell tool as a detached background command " +
              "(detach: true) and don't wait for it or read its output: " +
              "sh -c 'echo $$ > bg.pid; exec sleep 300'\nThen reply with the single word: started",
          ),
          "next",
        );
        expect((await log.turn(1)).outcome).toBe("completed");
        const background = await pidIn(join(folder, "bg.pid"));
        expect(isRunning(background)).toBe(true);
        await session.end();
        await vi.waitFor(() => expect(isRunning(background)).toBe(false), { timeout: 10_000 });
        recordedUsage.push(`shell-processes: ${usageOf(recorder.text())}`);
      }, 300_000);
    });
  },
);

/**
 * The contract and the scenarios above in the default run, with no model call: each on stand-in
 * runtimes replaying its recording, which check everything the session asks of them against it,
 * ask the session's hook where the runtime did and run its Office tools for real.
 */
describe("CopilotSdkEngine on stand-in runtimes replaying the recordings", () => {
  const officeData = new OfficeDataDirectory(
    join(tmpdir(), `office-copilot-replay-${randomUUID()}`),
  );
  const engine = liveEngine(null);
  const replays = new Map<AgentEngine, CopilotReplay>();

  afterAll(async () => {
    await rm(officeData.path, { recursive: true, force: true });
  });

  async function replaying(scenario: string): Promise<AgentEngine> {
    const replay = await CopilotReplay.of(recording(scenario));
    const copilot = new CopilotSdkEngine(officeData, replay.open);
    replays.set(copilot, replay);
    return copilot;
  }

  function expectReplayed(scenario: string, used: AgentEngine): void {
    const unreplayed = replays.get(used)?.unreplayed() ?? [];
    if (unreplayed.length > 0) {
      throw new Error(
        `The session stopped before the end of runtime ${unreplayed.join(", ")} of ${scenario}.jsonl.`,
      );
    }
  }

  describeAgentEngineContract("CopilotSdkEngine on replaying stand-ins", {
    capabilities: COPILOT_CLI_CAPABILITIES,
    engine,
    model: LIVE_MODEL,
    timeoutMs: 20_000,
    mcpServer: CONTRACT_MCP_SERVER,
    backgroundCommands: false,
    engineFor: (scenario) =>
      SESSIONLESS_SCENARIOS.includes(scenario)
        ? Promise.resolve(
            new CopilotSdkEngine(officeData, () => Promise.reject(new Error("No runtime here."))),
          )
        : replaying(scenario),
    afterScenario: (scenario, used) => {
      if (!SESSIONLESS_SCENARIOS.includes(scenario)) expectReplayed(scenario, used);
      return Promise.resolve();
    },
  });

  describe("its own scenarios", () => {
    let folder: string;
    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "office-engine-"));
    });
    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    it.each(ENGINE_SCENARIOS)("$title", async (scenario) => {
      const used = await replaying(scenario.name);
      await expect(scenario.run(used, folder, engine, 5_000)).resolves.toBeUndefined();
      expectReplayed(scenario.name, used);
    });

    it("stops the replay with words naming the line when the session sends what the recording doesn't have", async () => {
      const used = await replaying("reply");
      const session = await used.start({
        id: randomUUID(),
        options: scenarioOptions(folder, engine),
        brief: message("Reply with the single word: steady"),
      });
      await expect(reading(session).finished).rejects.toThrow(
        /The replay of reply\.jsonl, runtime 1: line \d+: send\.prompt is "Reply with the single word: steady" where the recording has "Reply with the single word: ready"/,
      );
      await session.end();
      expect(replays.get(used)?.unreplayed()).toEqual([1]);
    });
  });
});

function redacted(): string {
  return "[a token]";
}

/**
 * The live run's token: a fine-grained one as the engine keeps it, or else, as the engine check's
 * account is signed in by GitHub's device flow (`gho_…`), which `CopilotCliToken` refuses, a
 * stand-in that only reveals it to the adapter, redacted as the real one everywhere else.
 */
function liveToken(text: string): CopilotCliToken {
  if (/^github_pat_\w+$/.test(text.trim())) return CopilotCliToken.of(text);
  return {
    reveal: () => text,
    toString: redacted,
    toJSON: redacted,
    [Symbol.for("nodejs.util.inspect.custom")]: redacted,
  } as unknown as CopilotCliToken;
}

function recording(scenario: string): string {
  return join(RUNTIME_RECORDINGS, `${scenario}.jsonl`);
}

/** The id a command wrote to `file`, once it has. */
async function pidIn(file: string): Promise<number> {
  let pid = Number.NaN;
  await vi.waitFor(
    async () => {
      pid = Number((await readFile(file, "utf8")).trim());
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${file} holds no process id yet.`);
    },
    { timeout: 120_000, interval: 250 },
  );
  return pid;
}

/** The tokens and premium requests a recording's `assistant.usage` events give, summed. */
function usageOf(text: string): string {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let calls = 0;
  let requests = 0;
  let chatUsed: unknown;
  const models = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.includes('"assistant.usage"')) continue;
    const { event } = JSON.parse(line) as {
      event?: { type: string; data: Record<string, unknown> };
    };
    if (event?.type !== "assistant.usage") continue;
    calls += 1;
    input += Number(event.data["inputTokens"] ?? 0);
    output += Number(event.data["outputTokens"] ?? 0);
    cacheRead += Number(event.data["cacheReadTokens"] ?? 0);
    requests += Number(event.data["cost"] ?? 0);
    if (typeof event.data["model"] === "string") models.add(event.data["model"]);
    const quota = event.data["quotaSnapshots"] as
      Record<string, { usedRequests?: unknown } | undefined> | undefined;
    chatUsed = quota?.["chat"]?.usedRequests ?? chatUsed;
  }
  return (
    `${calls} model calls (${[...models].join(", ")}), ${input} input (of which ${cacheRead} cache read), ` +
    `${output} output tokens, ${requests} requests; the chat quota's used requests then ${String(chatUsed)}`
  );
}

/** The files under `folder` holding `secret`, by path. */
async function filesHolding(folder: string, secret: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  const holding: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, "latin1").catch(() => "");
    if (text.includes(secret)) holding.push(path);
  }
  return holding;
}
