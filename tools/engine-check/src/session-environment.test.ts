import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeCodeSessionEnvironment, sessionEnvironment } from "./session-environment.ts";

test("a Claude Code session gets the token as CLAUDE_CODE_OAUTH_TOKEN, and other sessions don't", () => {
  const parent = {
    PATH: "/bin",
    ENGINE_CHECK_CLAUDE_CODE_OAUTH_TOKEN: " secret-token\n",
    CLAUDE_CODE_OAUTH_TOKEN: "inherited",
  };
  assert.deepEqual(claudeCodeSessionEnvironment(parent), {
    PATH: "/bin",
    ENGINE_CHECK_CLAUDE_CODE_OAUTH_TOKEN: " secret-token\n",
    CLAUDE_CODE_OAUTH_TOKEN: "secret-token",
  });
  assert.equal(sessionEnvironment(parent).CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test("without the token variable a Claude Code session uses ~/.claude, as before", () => {
  assert.deepEqual(
    claudeCodeSessionEnvironment({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "inherited" }),
    { PATH: "/bin" },
  );
  assert.deepEqual(claudeCodeSessionEnvironment({ ENGINE_CHECK_CLAUDE_CODE_OAUTH_TOKEN: " " }), {
    ENGINE_CHECK_CLAUDE_CODE_OAUTH_TOKEN: " ",
  });
});

test("drops engine, API and telemetry variables in any case and keeps the rest", () => {
  const environment = sessionEnvironment({
    PATH: "/bin",
    ANTHROPIC_API_KEY: "key",
    CLAUDECODE: "1",
    claude_config_dir: "/elsewhere",
    CLAUDE_CODE_PLUGIN_DIRS: "/plugins",
    MCP_CONNECTION_NONBLOCKING: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    OPENAI_API_KEY: "key",
    CODEX_HOME: "/elsewhere",
    UNSET: undefined,
  });
  assert.deepEqual(environment, { PATH: "/bin" });
});
