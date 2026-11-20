import { Injectable } from "@nestjs/common";
import type { UsageWindows } from "../../domain/usage-windows.js";
import { AgentEngine, type NewSession } from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { GEMINI_CLI_CAPABILITIES } from "./gemini-cli-capabilities.js";

/** A session on a Gemini CLI engine, refused until its adapter runs one. */
export class GeminiCliSessionsUnavailable extends Error {
  constructor() {
    super("Sessions on a Gemini CLI engine can't run yet.");
    this.name = "GeminiCliSessionsUnavailable";
  }
}

/**
 * The Gemini CLI engines' place until their adapter lands: it declares what the engine check found
 * the engine can do, so the engine cascade's capability check and the Role card are already right,
 * and refuses every session in words.
 */
@Injectable()
export class UnavailableGeminiCliEngine extends AgentEngine {
  readonly capabilities = GEMINI_CLI_CAPABILITIES;

  start(session: NewSession): Promise<EngineSession> {
    void session;
    return Promise.reject(new GeminiCliSessionsUnavailable());
  }

  resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    void sessionId;
    void options;
    return Promise.reject(new GeminiCliSessionsUnavailable());
  }

  /** A Gemini API key has no usage windows. */
  readUsageWindows(): Promise<UsageWindows | undefined> {
    return Promise.resolve(undefined);
  }
}
