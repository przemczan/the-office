import type { Engine } from "../domain/engines.js";
import type { AgentEngine } from "../ports/agent-engine.js";

/**
 * A way of running a session, each with its adapter: the Agent SDK, the `-p` fallback, or The
 * Office's own loop on an API endpoint.
 */
export type EngineAdapter = "agent-sdk" | "claude-code-p" | "openai-compatible-api";

/**
 * An adapter per way of running a session (spec §5.4); the module binds one to each. An API engine
 * runs on The Office's own loop, a Claude Code engine on the Agent SDK, or on `-p` when its switch
 * is on.
 */
export class AgentEngines {
  constructor(private readonly adapters: Readonly<Record<EngineAdapter, AgentEngine>>) {}

  /** The adapter of `engine`. */
  of(engine: Engine): AgentEngine {
    if (engine.kind === "openai-compatible-api") return this.adapters["openai-compatible-api"];
    return this.adapters[engine.claudeCodeP ? "claude-code-p" : "agent-sdk"];
  }

  /** The adapter a Role card's engine names, for what it can do, until step 1c3 of task 47. */
  named(adapter: EngineAdapter): AgentEngine {
    return this.adapters[adapter];
  }
}
