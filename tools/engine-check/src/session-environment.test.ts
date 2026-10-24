import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionEnvironment } from "./session-environment.ts";

test("drops engine, API and telemetry variables in any case and keeps the rest", () => {
  const environment = sessionEnvironment({
    PATH: "/bin",
    ANTHROPIC_API_KEY: "key",
    CLAUDECODE: "1",
    claude_config_dir: "/elsewhere",
    CLAUDE_CODE_PLUGIN_DIRS: "/plugins",
    MCP_CONNECTION_NONBLOCKING: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    UNSET: undefined,
  });
  assert.deepEqual(environment, { PATH: "/bin" });
});
