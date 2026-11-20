import assert from "node:assert/strict";
import { test } from "node:test";
import { geminiEnvironment } from "./session-environment.ts";

test("drops Gemini, Google, browser and telemetry variables in any case and keeps the rest", () => {
  const environment = geminiEnvironment({
    PATH: "/bin",
    GEMINI_API_KEY: "key",
    gemini_cli_home: "/elsewhere",
    GOOGLE_GENAI_USE_VERTEXAI: "true",
    GOOGLE_CLOUD_PROJECT: "project",
    NO_BROWSER: "true",
    BROWSER: "firefox",
    CLOUD_SHELL: "true",
    MCP_TIMEOUT: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    ANTHROPIC_API_KEY: "key",
    UNSET: undefined,
  });
  assert.deepEqual(environment, { PATH: "/bin" });
});
