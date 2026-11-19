import { describe, expect, it } from "vitest";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../domain/engines.js";
import { AgentEngines, type EngineAdapter } from "./agent-engines.js";

const ADAPTERS: Readonly<Record<EngineAdapter, ScriptedEngine>> = {
  "agent-sdk": new ScriptedEngine([]),
  "claude-code-p": new ScriptedEngine([]),
  "openai-compatible-api": new ScriptedEngine([]),
  codex: new ScriptedEngine([]),
};

const ENGINES: Readonly<Record<EngineAdapter, Engine>> = {
  "agent-sdk": FIRST_CLAUDE_CODE_ENGINE,
  "claude-code-p": { ...FIRST_CLAUDE_CODE_ENGINE, id: "fallback", claudeCodeP: true },
  "openai-compatible-api": {
    id: "lab",
    name: "Lab",
    kind: "openai-compatible-api",
    defaultModel: "coder",
    baseUrl: "http://localhost:11434/v1",
    key: "",
    models: [{ id: "coder", contextWindow: 32_000 }],
  },
  codex: { id: "codex", name: "Codex", kind: "codex", defaultModel: "gpt-6-luna", apiKey: null },
};

describe("AgentEngines", () => {
  it.each(Object.keys(ENGINES) as EngineAdapter[])("runs a %s engine on its adapter", (adapter) => {
    expect(new AgentEngines(ADAPTERS).of(ENGINES[adapter])).toBe(ADAPTERS[adapter]);
  });
});
