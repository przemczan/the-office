import { describe, expect, it } from "vitest";
import { z } from "zod";
import { windows } from "../../../../platform/os/windows.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";
import {
  claudeCodePEnvironment,
  claudeCodePMcpConfig,
  TOKEN_VARIABLE,
} from "./claude-code-p-arguments.js";
import {
  OPTIONS,
  SKILLS,
  argumentsFor,
  flag,
  settingsOf,
} from "./claude-code-p-arguments.fixtures.js";

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
      workingFolder: OPTIONS.folder,
    },
    tools: [],
  },
  {
    name: "search",
    launch: { transport: "streamable-http", url: "https://mcp.example.com/mcp", headers: {} },
    tools: [],
  },
];

describe("claudeCodePArguments", () => {
  it("resumes an ended session by its id", () => {
    const args = argumentsFor({ resumes: true });

    expect(flag(args, "resume")).toBe("session-1");
    expect(flag(args, "session-id")).toBeUndefined();
  });

  it("names the same tools as the SDK adapter, PowerShell beside Bash where Agents have it", () => {
    const tools = flag(argumentsFor({ agentShells: ["bash", "powershell"] }), "tools")?.split(",");

    expect(tools).toContain("Bash");
    expect(tools).toContain("PowerShell");
    expect(tools).toContain("Grep");
    expect(tools).toEqual(tools?.toSorted());
  });

  it("loads the session's skills folder and allows each of its skills by rule", () => {
    const args = argumentsFor({ options: { ...OPTIONS, skills: SKILLS } });

    expect(flag(args, "plugin-dir")).toBe(SKILLS.folder);
    expect(flag(args, "allowedTools")).toBe("Skill(office:tdd),Skill(deploy)");
  });

  it("loads no plugin and allows no skill for a session without skills", () => {
    const args = argumentsFor();

    expect(flag(args, "plugin-dir")).toBeUndefined();
    expect(flag(args, "allowedTools")).toBeUndefined();
  });

  it("names the LSP tool, and its language servers' plugin beside the skills folder", () => {
    const args = argumentsFor({
      options: { ...OPTIONS, skills: SKILLS },
      languageServerPlugin: "/data/sessions/s1/language-servers",
    });

    expect(flag(args, "tools")?.split(",")).toContain("LSP");
    expect(args.filter((argument) => argument.startsWith("--plugin-dir="))).toEqual([
      `--plugin-dir=${SKILLS.folder}`,
      "--plugin-dir=/data/sessions/s1/language-servers",
    ]);
  });

  it("reads the session's MCP config from its file, as one value of the flag", () => {
    const args = argumentsFor({ mcpConfigFile: "/office/sessions/session-1/mcp-config-1.json" });

    expect(args.filter((arg) => arg.startsWith("--mcp-config"))).toEqual([
      "--mcp-config=/office/sessions/session-1/mcp-config-1.json",
    ]);
  });

  it("names no MCP config for a session without one", () => {
    expect(argumentsFor().some((arg) => arg.startsWith("--mcp-config"))).toBe(false);
  });

  it("allows the Office tool server and each MCP server by rule", () => {
    const args = argumentsFor({
      options: { ...OPTIONS, officeTools: [NOTE_TOOL], mcpServers: MCP_SERVERS },
    });

    expect(settingsOf(args)).toMatchObject({
      permissions: { allow: ["mcp__office", "mcp__github", "mcp__search"] },
    });
  });

  it("appends the instructions from their file, and holds each turn to the output schema", () => {
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    const args = argumentsFor({
      options: { ...OPTIONS, instructions: "Be brief.", outputSchema: schema },
      instructionsFile: "/tmp/office-claude-code-p-1/instructions.md",
    });

    expect(flag(args, "append-system-prompt-file")).toBe(
      "/tmp/office-claude-code-p-1/instructions.md",
    );
    expect(JSON.parse(flag(args, "json-schema") ?? "null")).toEqual(schema);
  });

  it("appends nothing without instructions, and asks no output schema without one", () => {
    const args = argumentsFor();

    expect(flag(args, "append-system-prompt-file")).toBeUndefined();
    expect(flag(args, "json-schema")).toBeUndefined();
  });
});

describe("claudeCodePMcpConfig", () => {
  it("names the service's Office tool server, which the binary reaches through its stream", () => {
    expect(claudeCodePMcpConfig({ ...OPTIONS, officeTools: [NOTE_TOOL] })).toEqual({
      mcpServers: { office: { type: "sdk", name: "office" } },
    });
  });

  it("is none for a session without Office tools or MCP servers", () => {
    expect(claudeCodePMcpConfig(OPTIONS)).toBeUndefined();
  });

  it("holds the session's MCP servers with their values, a local one without the token", () => {
    expect(claudeCodePMcpConfig({ ...OPTIONS, mcpServers: MCP_SERVERS })).toEqual({
      mcpServers: {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "secret", [TOKEN_VARIABLE]: "" },
        },
        search: { type: "http", url: "https://mcp.example.com/mcp", headers: {} },
      },
    });
  });
});

describe("claudeCodePEnvironment", () => {
  const configFolder = "/office/engines/claude-code";

  it("drops the caller's token under any case on Windows, where variables ignore it", () => {
    const environment = { Path: "C:\\Windows", office_session_token: "the caller's" };

    expect(
      claudeCodePEnvironment(
        { environment },
        { configFolder, token: "token" },
        windows({ variables: {}, homeDirectory: "C:\\Users\\office" }),
      ),
    ).toEqual({ Path: "C:\\Windows", CLAUDE_CONFIG_DIR: configFolder, [TOKEN_VARIABLE]: "token" });
  });
});
