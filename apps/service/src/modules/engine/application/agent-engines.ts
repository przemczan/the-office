import type { Engine } from "../domain/engines.js";
import type { AgentEngine } from "../ports/agent-engine.js";

/**
 * A way of running a session, each with its adapter: the Agent SDK, the `-p` fallback, The
 * Office's own loop on an API endpoint, or Codex's app-server.
 */
export type EngineAdapter = "agent-sdk" | "claude-code-p" | "openai-compatible-api" | "codex";

/**
 * An adapter per way of running a session (spec §5.4); the module binds one to each. An API engine
 * runs on The Office's own loop, a Codex engine on its app-server, a Claude Code engine on the Agent
 * SDK, or on `-p` when its switch is on.
 */
export class AgentEngines {
  constructor(private readonly adapters: Readonly<Record<EngineAdapter, AgentEngine>>) {}

  /** The adapter of `engine`. */
  of(engine: Engine): AgentEngine {
    switch (engine.kind) {
      case "openai-compatible-api":
        return this.adapters["openai-compatible-api"];
      case "codex":
        return this.adapters.codex;
      case "claude-code":
        return this.adapters[engine.claudeCodeP ? "claude-code-p" : "agent-sdk"];
    }
  }
}
