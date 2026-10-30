import { Injectable } from "@nestjs/common";
import { AgentEngine, type EngineCapabilities } from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";

/**
 * The `-p` fallback (spec §5.4): the pinned binary in `claude -p`, with stream-json in and out.
 * Not built yet (task 29, step 4): it refuses every session, so a Role switched to it is told so.
 */
@Injectable()
export class ClaudeCodePEngine extends AgentEngine {
  /** What the engine check found the fallback can do (docs/engine-check.md, "The `-p` fallback"). */
  readonly capabilities: EngineCapabilities = {
    bargeIn: true,
    interrupt: true,
    resume: true,
    usageWindows: true,
    contextUsage: true,
    officeTools: true,
    outputSchema: true,
  };

  start(): Promise<EngineSession> {
    return Promise.reject(notBuilt());
  }

  resume(): Promise<EngineSession> {
    return Promise.reject(notBuilt());
  }
}

function notBuilt(): Error {
  return new Error("The Claude Code -p engine can't run sessions yet; pick the Agent SDK.");
}
