import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sdkOptions, type SdkSession } from "./sdk-options.js";

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
  model: "claude-haiku-5-5",
  effort: "medium",
  skills: undefined,
  profile: { edit: true, run: { kind: "anything" }, web: true },
  officeTools: [],
  outputSchema: undefined,
};

const NOTE_TOOL: OfficeTool = {
  name: "note",
  description: "Notes a word.",
  input: z.object({ word: z.string() }),
  run: () => Promise.resolve({ text: "Noted.", isError: false }),
};

const PRE_TOOL_USE: HookCallback = () => Promise.resolve({});

function optionsFor(session: Partial<SdkSession> = {}) {
  return sdkOptions({
    id: "session-1",
    resumes: false,
    options: OPTIONS,
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
        syncClaudeAiSkills: false,
        syncClaudeAiPlugins: false,
        disableBundledSkills: true,
        disableClaudeAiConnectors: true,
        autoMemoryEnabled: false,
        autoDreamEnabled: false,
        enabledPlugins: {
          "cc-plugin-agents-md@builtin": false,
          "cc-plugin-telemetry@builtin": false,
          "cc-plugin-plugin-authoring@builtin": false,
        },
        permissions: {
          blockReadsOutsideWorkingDirectories: true,
          additionalDirectories: [],
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

  it("runs the session with the given variables, without the engine's nor The Office's own", () => {
    expect(optionsFor().env).toEqual({ PATH: "/usr/bin", GREETING: "hello" });
  });

  it("resumes a session by its id", () => {
    const options = optionsFor({ resumes: true });

    expect(options.resume).toBe("session-1");
    expect(options.sessionId).toBeUndefined();
  });

  it("loads the skills folder as a plugin the file tools may read, listing only its skills", () => {
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
      permissions: { additionalDirectories: ["/office/sessions/s/skills"] },
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

  it("holds each turn's output to the output schema", () => {
    const schema = { type: "object", properties: { word: { type: "string" } } };
    const options = optionsFor({ options: { ...OPTIONS, outputSchema: schema } });

    expect(options.outputFormat).toEqual({ type: "json_schema", schema });
  });
});
