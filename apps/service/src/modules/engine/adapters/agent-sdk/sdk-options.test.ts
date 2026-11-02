import {
  query,
  type HookCallback,
  type SDKUserMessage,
  type SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import { sdkMcpConfig, sdkOptions, type SdkSession } from "./sdk-options.js";

const OPTIONS: SessionOptions = {
  folder: "/office/worktrees/task-1",
  environment: {
    PATH: "/usr/bin",
    GREETING: "hello",
    ANTHROPIC_API_KEY: "key",
    CLAUDECODE: "1",
    claude_config_dir: "/elsewhere",
    MCP_TIMEOUT: "10",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    DATABASE_URL: "postgres://office:secret@localhost:5432/office",
    OFFICE_PORT: "4100",
  },
  engine: FIRST_CLAUDE_CODE_ENGINE,
  model: "claude-haiku-5-5",
  effort: "medium",
  skills: undefined,
  profile: { edit: true, run: { kind: "anything" }, web: true, mcpTools: {} },
  officeTools: [],
  mcpServers: [],
  instructions: "",
  outputSchema: undefined,
};

const NOTE_TOOL: OfficeTool = {
  name: "note",
  description: "Notes a word.",
  input: z.object({ word: z.string() }),
  run: () => Promise.resolve({ text: "Noted.", isError: false }),
};

const PRE_TOOL_USE: HookCallback = () => Promise.resolve({});

const MCP_SERVERS: SessionOptions["mcpServers"] = [
  {
    name: "github",
    launch: {
      transport: "stdio",
      command: "npx",
      arguments: ["-y", "@modelcontextprotocol/server-github"],
      environmentVariables: { GITHUB_TOKEN: "secret" },
      workingFolder: "/office/worktrees/task-1",
    },
    tools: [],
  },
  {
    name: "search",
    launch: {
      transport: "streamable-http",
      url: "https://mcp.example.com/mcp",
      headers: { "X-Key": "k" },
    },
    tools: [],
  },
];

const CONFIG_FOLDER = "/office/engines/claude-code";

const MCP_CONFIG_FILE = "/office/sessions/session-1/mcp-config-1.json";

/** What the SDK would start the binary with, which never starts here. */
function spawnedWith(session: Partial<SdkSession>): SpawnOptions {
  const spawned: SpawnOptions[] = [];
  const startQuery = () =>
    query({
      prompt: new AsyncChannel<SDKUserMessage>(),
      options: optionsFor({
        ...session,
        spawnProcess: (spawn) => {
          spawned.push(spawn);
          throw new Error("Not started in this test.");
        },
      }),
    });
  // The SDK starts the binary as the query is made.
  expect(startQuery).toThrow("Not started in this test.");
  const [spawn] = spawned;
  if (spawn === undefined) throw new Error("The SDK started no binary.");
  return spawn;
}

function optionsFor(session: Partial<SdkSession> = {}) {
  return sdkOptions({
    id: "session-1",
    resumes: false,
    options: OPTIONS,
    configFolder: CONFIG_FOLDER,
    mcpConfigFile: undefined,
    agentShells: ["bash"],
    preToolUse: PRE_TOOL_USE,
    spawnProcess: () => {
      throw new Error("Not started in this test.");
    },
    ...session,
  });
}

describe("sdkOptions", () => {
  it("starts a new session by its id, on the Office's lean and isolated settings", () => {
    const options = optionsFor();

    expect(options).toMatchObject({
      cwd: OPTIONS.folder,
      model: "claude-haiku-5-5",
      effort: "medium",
      sessionId: "session-1",
      settingSources: ["project"],
      plugins: [],
      permissionPrompts: "none",
      systemPrompt: { type: "preset", preset: "claude_code", excludeDynamicSections: true },
      settings: {
        claudeMdExcludes: ["/office/worktrees", "/office", ""].flatMap((folder) => [
          `${folder}/CLAUDE.md`,
          `${folder}/CLAUDE.local.md`,
          `${folder}/.claude/CLAUDE.md`,
          `${folder}/.claude/rules/**`,
        ]),
        syncClaudeAiSkills: false,
        syncClaudeAiPlugins: false,
        disableBundledSkills: true,
        disableClaudeAiConnectors: true,
        autoMemoryEnabled: false,
        autoCompactEnabled: false,
        idleCompaction: false,
        autoDreamEnabled: false,
        enabledPlugins: {
          "cc-plugin-agents-md@builtin": false,
          "cc-plugin-telemetry@builtin": false,
          "cc-plugin-plugin-authoring@builtin": false,
        },
        permissions: {
          blockReadsOutsideWorkingDirectories: false,
          allow: [],
        },
      },
    });
    expect(options.resume).toBeUndefined();
    expect(options.mcpServers).toBeUndefined();
    expect(options.outputFormat).toBeUndefined();
  });

  it("names the built-in tools, with the system's shells, the same list on every system otherwise", () => {
    const linux = optionsFor({ agentShells: ["bash"] });
    const windows = optionsFor({ agentShells: ["bash", "powershell"] });

    expect(linux.tools).toContain("Bash");
    expect(linux.tools).not.toContain("PowerShell");
    expect(windows.tools).toEqual([...(linux.tools as string[]), "PowerShell"].toSorted());
    expect(linux.tools).toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "Edit", "Write"]));
  });

  it("decides every tool call by the one PreToolUse hook", () => {
    expect(optionsFor().hooks).toEqual({ PreToolUse: [{ hooks: [PRE_TOOL_USE] }] });
  });

  it("runs the session with the given variables, without the engine's nor The Office's own, on its engine's config folder", () => {
    expect(optionsFor().env).toEqual({
      PATH: "/usr/bin",
      GREETING: "hello",
      CLAUDE_CONFIG_DIR: CONFIG_FOLDER,
    });
  });

  it("adds the standing instructions to the system prompt, when there are any", () => {
    const options = optionsFor({
      options: { ...OPTIONS, instructions: "Plan in conversation." },
    });

    expect(options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      excludeDynamicSections: true,
      append: "Plan in conversation.",
    });
  });

  it("resumes a session by its id", () => {
    const options = optionsFor({ resumes: true });

    expect(options.resume).toBe("session-1");
    expect(options.sessionId).toBeUndefined();
  });

  it("loads the skills folder as a plugin, listing only its skills", () => {
    const options = optionsFor({
      options: {
        ...OPTIONS,
        skills: {
          folder: "/office/sessions/s/skills",
          names: ["office:review", "deploy"],
          expected: ["deploy", "office:review"],
          overrides: { lint: "off" },
        },
      },
    });

    expect(options.plugins).toEqual([
      { type: "local", path: "/office/sessions/s/skills", skipMcpDiscovery: true },
    ]);
    expect(options.skills).toEqual(["office:review", "deploy"]);
    expect(options.settings).toMatchObject({
      disableSkillShellExecution: true,
      skillOverrides: { lint: "off" },
    });
  });

  it("lists no skill at all for a session without skills", () => {
    const options = optionsFor({ options: { ...OPTIONS, skills: undefined } });

    expect(options.plugins).toEqual([]);
    expect(options.skills).toEqual([]);
  });

  it("serves the Office tools from an in-process server, allowed by rule", () => {
    const options = optionsFor({ options: { ...OPTIONS, officeTools: [NOTE_TOOL] } });

    expect(Object.keys(options.mcpServers ?? {})).toEqual(["office"]);
    expect(options.mcpServers?.["office"]).toMatchObject({ type: "sdk", name: "office" });
    expect(options.settings).toMatchObject({ permissions: { allow: ["mcp__office"] } });
  });

  it("names the session's MCP config file, holding its servers, beside the in-process server", () => {
    const options = optionsFor({
      options: { ...OPTIONS, officeTools: [NOTE_TOOL], mcpServers: MCP_SERVERS },
      mcpConfigFile: MCP_CONFIG_FILE,
    });

    expect(options.strictMcpConfig).toBe(true);
    expect(options.extraArgs).toEqual({ "mcp-config": MCP_CONFIG_FILE });
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["office"]);
    expect(options.settings).toMatchObject({
      permissions: { allow: ["mcp__office", "mcp__github", "mcp__search"] },
    });
  });

  it("names no MCP config file for a session without one", () => {
    expect(optionsFor().extraArgs).toBeUndefined();
  });

  it("starts the binary with the file as the one MCP config, no Server value on its command line or in its environment", () => {
    const { args, env } = spawnedWith({
      options: { ...OPTIONS, officeTools: [NOTE_TOOL], mcpServers: MCP_SERVERS },
      mcpConfigFile: MCP_CONFIG_FILE,
    });

    const flags = args.flatMap((arg, index) => (arg.startsWith("--mcp-config") ? [index] : []));
    expect(flags.map((index) => args[index])).toEqual(["--mcp-config"]);
    const [index = -1] = flags;
    expect(args[index + 1]).toBe(MCP_CONFIG_FILE);
    // The flag takes several values: what follows the file is another flag, never a value.
    expect(args[index + 2] ?? "--").toMatch(/^--/);
    const started = [...args, ...Object.values(env)].join(" ");
    for (const value of ["secret", "X-Key", "server-github"]) {
      expect(started).not.toContain(value);
    }
  });

  it("never runs a Project's own MCP servers, even with no server of the session's", () => {
    expect(optionsFor().strictMcpConfig).toBe(true);
  });

  it("holds each turn's output to the output schema", () => {
    const schema = { type: "object", properties: { word: { type: "string" } } };
    const options = optionsFor({ options: { ...OPTIONS, outputSchema: schema } });

    expect(options.outputFormat).toEqual({ type: "json_schema", schema });
  });
});

describe("sdkMcpConfig", () => {
  it("holds the session's MCP servers with their values, without the in-process server", () => {
    expect(sdkMcpConfig({ ...OPTIONS, officeTools: [NOTE_TOOL], mcpServers: MCP_SERVERS })).toEqual(
      {
        mcpServers: {
          github: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "secret" },
          },
          search: { type: "http", url: "https://mcp.example.com/mcp", headers: { "X-Key": "k" } },
        },
      },
    );
  });

  it("is none for a session without MCP servers", () => {
    expect(sdkMcpConfig({ ...OPTIONS, officeTools: [NOTE_TOOL] })).toBeUndefined();
  });
});
