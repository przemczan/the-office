import { describe, expect, it } from "vitest";
import { OPTIONS, PRE_TOOL_USE, CONFIG_FOLDER, optionsFor } from "./sdk-options.fixtures.js";

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

  it("decides every tool call by the one PreToolUse hook", () => {
    expect(optionsFor().hooks).toEqual({ PreToolUse: [{ hooks: [PRE_TOOL_USE] }] });
  });

  it("runs the session with the given variables, without the engine's, The Office's own nor the container runtime's, on its engine's config folder", () => {
    expect(optionsFor().env).toEqual({
      PATH: "/usr/bin",
      GREETING: "hello",
      CLAUDE_CONFIG_DIR: CONFIG_FOLDER,
    });
  });

  it("signs a session in by the engine's API key through the helper, only on an engine an API key signs in", () => {
    const helper = "'/usr/bin/node' -e '…' '/office/engines/claude-code/.anthropic-api-key'";

    expect(optionsFor({ apiKeyHelper: helper }).settings).toMatchObject({ apiKeyHelper: helper });
    expect(optionsFor().settings).not.toHaveProperty("apiKeyHelper");
  });

  it("gives a session no API key or token in its environment, whoever passed one", () => {
    const options = optionsFor({
      options: {
        ...OPTIONS,
        environment: {
          PATH: "/usr/bin",
          ANTHROPIC_API_KEY: "sk-ant-api03-the-callers",
          ANTHROPIC_AUTH_TOKEN: "a-token",
          CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-the-callers",
        },
      },
    });

    expect(options.env).toEqual({ PATH: "/usr/bin", CLAUDE_CONFIG_DIR: CONFIG_FOLDER });
  });

  it("never runs a Project's own MCP servers, even with no server of the session's", () => {
    expect(optionsFor().strictMcpConfig).toBe(true);
  });
});
