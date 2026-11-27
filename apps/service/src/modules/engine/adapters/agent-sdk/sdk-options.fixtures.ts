import { type HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sdkOptions, type SdkSession } from "./sdk-options.js";

// What sdk-options.test.ts and sdk-options.full.test.ts share.

export const OPTIONS: SessionOptions = {
  deferredOfficeTools: [],
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
    DOCKER_HOST: "unix:///var/run/docker.sock",
    DOCKER_CONTEXT: "default",
    CONTAINER_HOST: "unix:///run/podman/podman.sock",
  },
  engine: FIRST_CLAUDE_CODE_ENGINE,
  model: "claude-haiku-5-5",
  effort: "medium",
  skills: undefined,
  profile: { edit: true, run: { kind: "anything" }, web: true, mcpTools: {} },
  officeTools: [],
  mcpServers: [],
  languageServers: [],
  instructions: "",
  outputSchema: undefined,
};

export const PRE_TOOL_USE: HookCallback = () => Promise.resolve({});

export const CONFIG_FOLDER = "/office/engines/claude-code";

export function optionsFor(session: Partial<SdkSession> = {}) {
  return sdkOptions({
    id: "session-1",
    resumes: false,
    options: OPTIONS,
    configFolder: CONFIG_FOLDER,
    apiKeyHelper: undefined,
    mcpConfigFile: undefined,
    languageServerPlugin: undefined,
    agentShells: ["bash"],
    preToolUse: PRE_TOOL_USE,
    officeToolCall: anOfficeToolCall("session-1"),
    spawnProcess: () => {
      throw new Error("Not started in this test.");
    },
    ...session,
  });
}
