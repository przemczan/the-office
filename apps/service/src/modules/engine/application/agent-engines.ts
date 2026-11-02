import type { Engine, RoleEngine } from "../domain/engines.js";
import type { AgentEngine } from "../ports/agent-engine.js";

/**
 * An adapter per way of running a session (spec §5.4); the module binds one to each. An API engine
 * runs on The Office's own loop, a Claude Code engine on the Agent SDK, or on `-p` when its switch
 * is on.
 */
export class AgentEngines {
  constructor(private readonly adapters: Readonly<Record<RoleEngine, AgentEngine>>) {}

  /**
   * The adapter of `engine`. A Role card naming `-p` keeps it until step 1c2 of task 47 moves such
   * Roles to the engine with its switch off.
   */
  of(engine: Engine, roleEngine?: RoleEngine): AgentEngine {
    if (engine.kind === "openai-compatible-api") return this.adapters["openai-compatible-api"];
    const claudeCodeP = engine.claudeCodeP || roleEngine === "claude-code-p";
    return this.adapters[claudeCodeP ? "claude-code-p" : "agent-sdk"];
  }

  /** The adapter a Role card's engine names, for what it can do. */
  named(roleEngine: RoleEngine): AgentEngine {
    return this.adapters[roleEngine];
  }
}
