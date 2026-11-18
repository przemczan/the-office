import { describe, expect, it } from "vitest";
import { linux } from "../../../../platform/os/linux.js";
import { sessionSettings } from "../claude-code/session-settings.js";
import { claudeCodePEnvironment, TOKEN_VARIABLE } from "./claude-code-p-arguments.js";
import {
  OPTIONS,
  SKILLS,
  HOOK_URL,
  argumentsFor,
  flag,
  settingsOf,
} from "./claude-code-p-arguments.fixtures.js";

const AUTHORIZATION = { Authorization: `Bearer \${${TOKEN_VARIABLE}}` };

describe("claudeCodePArguments", () => {
  it("starts a new session by its id in -p, stream-json in and out, on the lean options", () => {
    const args = argumentsFor();

    expect(args.slice(0, 4)).toEqual([
      "--print",
      "--input-format=stream-json",
      "--output-format=stream-json",
      "--verbose",
    ]);
    expect(flag(args, "model")).toBe("claude-haiku-5-5");
    expect(flag(args, "effort")).toBe("medium");
    expect(flag(args, "setting-sources")).toBe("project");
    expect(flag(args, "permission-prompts")).toBe("none");
    expect(args).toContain("--exclude-dynamic-system-prompt-sections");
    expect(flag(args, "session-id")).toBe("session-1");
    expect(flag(args, "resume")).toBeUndefined();
  });

  it("gives the SDK adapter's settings, with a hook that asks the service and blocks when it can't", () => {
    const options = { ...OPTIONS, skills: SKILLS };
    const settings = settingsOf(argumentsFor({ options }));

    expect(settings).toEqual({
      ...sessionSettings(options, undefined),
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: "http",
                url: HOOK_URL,
                headers: AUTHORIZATION,
                allowedEnvVars: [TOKEN_VARIABLE],
                timeout: 600,
                onFailure: "block",
              },
            ],
          },
        ],
      },
    });
  });

  it("signs a session in by the engine's API key through the helper, which names the key file only", () => {
    const helper = "'/usr/bin/node' -e '…' '/office/engines/claude-code/.anthropic-api-key'";

    const args = argumentsFor({ apiKeyHelper: helper });

    expect(settingsOf(args)).toMatchObject({ apiKeyHelper: helper });
    expect(settingsOf(argumentsFor())).not.toHaveProperty("apiKeyHelper");
  });

  it("never runs a Project's own MCP servers", () => {
    expect(argumentsFor()).toContain("--strict-mcp-config");
  });
});

describe("claudeCodePEnvironment", () => {
  const configFolder = "/office/engines/claude-code";
  const linuxUser = { variables: {}, homeDirectory: "/home/office" };

  it("runs the binary on its engine's config folder with the session's token, not the caller's", () => {
    const environment = {
      PATH: "/usr/bin",
      CLAUDE_CONFIG_DIR: "/home/office/.claude",
      [TOKEN_VARIABLE]: "the caller's",
    };

    expect(
      claudeCodePEnvironment({ environment }, { configFolder, token: "token" }, linux(linuxUser)),
    ).toEqual({ PATH: "/usr/bin", CLAUDE_CONFIG_DIR: configFolder, [TOKEN_VARIABLE]: "token" });
  });
});
