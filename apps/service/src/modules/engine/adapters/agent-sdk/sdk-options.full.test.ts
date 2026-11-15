import { query, type SDKUserMessage, type SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import { sdkMcpConfig, type SdkSession } from "./sdk-options.js";
import { OPTIONS, optionsFor } from "./sdk-options.fixtures.js";

const NOTE_TOOL: OfficeTool = {
  name: "note",
  description: "Notes a word.",
  input: z.object({ word: z.string() }),
  run: () => Promise.resolve({ text: "Noted.", isError: false }),
};

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

describe("sdkOptions", () => {
  it("names the built-in tools, with the system's shells, the same list on every system otherwise", () => {
    const linux = optionsFor({ agentShells: ["bash"] });
    const windows = optionsFor({ agentShells: ["bash", "powershell"] });

    expect(linux.tools).toContain("Bash");
    expect(linux.tools).not.toContain("PowerShell");
    expect(windows.tools).toEqual([...(linux.tools as string[]), "PowerShell"].toSorted());
    expect(linux.tools).toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "Edit", "Write"]));
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

  it("gives every session the LSP tool and its language servers' plugin, skills or none", () => {
    const options = optionsFor({ languageServerPlugin: "/data/sessions/s1/language-servers" });

    expect(options.tools).toContain("LSP");
    expect(options.plugins).toEqual([
      { type: "local", path: "/data/sessions/s1/language-servers", skipMcpDiscovery: true },
    ]);
  });

  it("loads the skills folder as a plugin, listing only its skills", () => {
    const options = optionsFor({
      options: {
        ...OPTIONS,
        skills: {
          folder: "/office/sessions/s/skills",
          names: ["office:review", "deploy"],
          expected: ["deploy", "office:review"],
          userOnly: [],
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
