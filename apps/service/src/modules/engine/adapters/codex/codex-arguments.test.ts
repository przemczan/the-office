import { describe, expect, it } from "vitest";
import {
  codexAppServerArguments,
  codexEnvironment,
  codexMcpServers,
  tomlValue,
} from "./codex-arguments.js";

function overrides(): string[] {
  const args = codexAppServerArguments();
  return args.filter((_, index) => args[index - 1] === "-c");
}

describe("codexAppServerArguments", () => {
  it("starts the app-server with -c overrides only", () => {
    const args = codexAppServerArguments();

    expect(args[0]).toBe("app-server");
    expect(args.slice(1).filter((_, index) => index % 2 === 0)).toSatisfy((flags: string[]) =>
      flags.every((flag) => flag === "-c"),
    );
  });

  it("keeps the sandbox to the worktree, without the network, updates, web search or history", () => {
    expect(overrides()).toEqual(
      expect.arrayContaining([
        "sandbox_workspace_write.exclude_slash_tmp=true",
        "sandbox_workspace_write.exclude_tmpdir_env_var=true",
        "sandbox_workspace_write.network_access=false",
        "check_for_update_on_startup=false",
        'web_search="disabled"',
        'history.persistence="none"',
        'approvals_reviewer="user"',
      ]),
    );
  });

  it("leaves out Codex's own skills and reads CLAUDE.md as the Project's instructions", () => {
    expect(overrides()).toEqual(
      expect.arrayContaining([
        "skills.bundled.enabled=false",
        "skills.include_instructions=false",
        'project_doc_fallback_filenames=["CLAUDE.md"]',
      ]),
    );
  });

  it("turns off the features that bypass the Office rules, keeping shell, patches, MCP and steering", () => {
    const features = overrides().filter((override) => override.startsWith("features."));

    expect(features).toEqual(
      expect.arrayContaining(
        [
          "view_image",
          "apps",
          "plugins",
          "hooks",
          "image_generation",
          "browser_use",
          "browser_use_external",
          "computer_use",
          "in_app_browser",
          "multi_agent",
          "skill_search",
          "goals",
        ].map((feature) => `features.${feature}=false`),
      ),
    );
    expect(features.every((feature) => feature.endsWith("=false"))).toBe(true);
    expect(features.join(" ")).not.toMatch(
      /features\.(shell_tool|unified_exec|tool_call_mcp_elicitation)=/,
    );
  });
});

describe("tomlValue", () => {
  it("writes strings quoted, lists bracketed and the rest as they are", () => {
    expect(tomlValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(tomlValue(["a", 1, true])).toBe('["a", 1, true]');
    expect(tomlValue(false)).toBe("false");
  });
});

describe("codexEnvironment", () => {
  const environment = {
    PATH: "/usr/bin",
    PROJECT_SETTING: "kept",
    CODEX_HOME: "/home/office/.codex",
    codex_sandbox: "seatbelt",
    OPENAI_API_KEY: "sk-user",
    OpenAI_Base_Url: "https://elsewhere",
    DATABASE_URL: "postgres://office:secret@localhost/office",
    DOCKER_HOST: "unix:///var/run/docker.sock",
  };

  it("drops Codex's, OpenAI's, The Office's and the container runtime's variables", () => {
    expect(codexEnvironment(environment, "/data/engines/codex")).toEqual({
      PATH: "/usr/bin",
      PROJECT_SETTING: "kept",
      CODEX_HOME: "/data/engines/codex",
    });
  });
});

describe("codexMcpServers", () => {
  it("names each server's URL and the endpoint's token as its header, nothing else", () => {
    const endpoint = { token: "t0k3n", url: (server: string) => `http://127.0.0.1:4100/${server}` };

    expect(codexMcpServers(endpoint, ["office", "github"])).toEqual({
      office: {
        url: "http://127.0.0.1:4100/office",
        http_headers: { Authorization: "Bearer t0k3n" },
        startup_timeout_sec: 30,
        tool_timeout_sec: 14_400,
      },
      github: {
        url: "http://127.0.0.1:4100/github",
        http_headers: { Authorization: "Bearer t0k3n" },
        startup_timeout_sec: 30,
        tool_timeout_sec: 14_400,
      },
    });
  });
});
