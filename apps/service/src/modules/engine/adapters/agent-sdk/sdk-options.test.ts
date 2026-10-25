import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sdkOptions } from "./sdk-options.js";

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
  },
  model: "claude-haiku-5-5",
  effort: "medium",
  skillsFolder: undefined,
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

describe("sdkOptions", () => {
  it("starts a new session by its id, on the Office's lean and isolated settings", () => {
    const options = sdkOptions({
      id: "session-1",
      resumes: false,
      options: OPTIONS,
      agentShells: ["bash"],
    });

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
    const linux = sdkOptions({ id: "s", resumes: false, options: OPTIONS, agentShells: ["bash"] });
    const windows = sdkOptions({
      id: "s",
      resumes: false,
      options: OPTIONS,
      agentShells: ["bash", "powershell"],
    });

    expect(linux.tools).toContain("Bash");
    expect(linux.tools).not.toContain("PowerShell");
    expect(windows.tools).toEqual([...(linux.tools as string[]), "PowerShell"].toSorted());
    expect(linux.tools).toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "Edit", "Write"]));
  });

  it("runs the session with the given variables, without those that change how the engine runs", () => {
    const { env } = sdkOptions({ id: "s", resumes: false, options: OPTIONS, agentShells: [] });

    expect(env).toEqual({ PATH: "/usr/bin", GREETING: "hello" });
  });

  it("resumes a session by its id", () => {
    const options = sdkOptions({
      id: "session-1",
      resumes: true,
      options: OPTIONS,
      agentShells: [],
    });

    expect(options.resume).toBe("session-1");
    expect(options.sessionId).toBeUndefined();
  });

  it("loads the skills folder as a plugin the file tools may read", () => {
    const options = sdkOptions({
      id: "s",
      resumes: false,
      options: { ...OPTIONS, skillsFolder: "/office/sessions/s/skills" },
      agentShells: [],
    });

    expect(options.plugins).toEqual([
      { type: "local", path: "/office/sessions/s/skills", skipMcpDiscovery: true },
    ]);
    expect(options.settings).toMatchObject({
      permissions: { additionalDirectories: ["/office/sessions/s/skills"] },
    });
  });

  it("serves the Office tools from an in-process server, allowed by rule", () => {
    const options = sdkOptions({
      id: "s",
      resumes: false,
      options: { ...OPTIONS, officeTools: [NOTE_TOOL] },
      agentShells: [],
    });

    expect(Object.keys(options.mcpServers ?? {})).toEqual(["office"]);
    expect(options.mcpServers?.["office"]).toMatchObject({ type: "sdk", name: "office" });
    expect(options.settings).toMatchObject({ permissions: { allow: ["mcp__office"] } });
  });

  it("holds each turn's output to the output schema", () => {
    const schema = { type: "object", properties: { word: { type: "string" } } };
    const options = sdkOptions({
      id: "s",
      resumes: false,
      options: { ...OPTIONS, outputSchema: schema },
      agentShells: [],
    });

    expect(options.outputFormat).toEqual({ type: "json_schema", schema });
  });
});
