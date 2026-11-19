import assert from "node:assert/strict";
import { test } from "node:test";
import { copilotEnvironment } from "./options.ts";

test("drops Copilot's and GitHub's variables in any case, and the sessions' own dropped ones", () => {
  const environment = copilotEnvironment({
    PATH: "/bin",
    HOME: "/home/office",
    COPILOT_GITHUB_TOKEN: "token",
    COPILOT_HOME: "/elsewhere",
    copilot_model: "gpt-5",
    GH_TOKEN: "token",
    GH_HOST: "github.example.com",
    GITHUB_TOKEN: "token",
    github_actions: "true",
    ANTHROPIC_API_KEY: "key",
    CLAUDE_CONFIG_DIR: "/claude",
    OPENAI_API_KEY: "key",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    UNSET: undefined,
  });
  assert.deepEqual(environment, { PATH: "/bin", HOME: "/home/office" });
});

test("keeps variables that only contain a dropped prefix past their start", () => {
  assert.deepEqual(copilotEnvironment({ MY_GITHUB_TOKEN: "kept", XGH_: "kept" }), {
    MY_GITHUB_TOKEN: "kept",
    XGH_: "kept",
  });
});
