import type { UsageWindows } from "../../domain/usage-windows.js";
import {
  AgentEngine,
  SessionsNotRunYet,
  type EngineCapabilities,
} from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";

/**
 * What the Copilot CLI engine declares until its adapter runs sessions: nothing, so the cascade's
 * capability check refuses Stage Roles on it and the Role card names all it can't do.
 */
export const UNAVAILABLE_COPILOT_CLI_CAPABILITIES: EngineCapabilities = {
  bargeIn: false,
  interrupt: false,
  resume: false,
  usageWindows: false,
  contextUsage: false,
  officeTools: false,
  outputSchema: false,
  languageServers: false,
  carrySession: false,
};

/** Why a session on a Copilot CLI engine is refused until its adapter lands. */
export const COPILOT_CLI_SESSIONS_REFUSAL = "Sessions on a Copilot CLI engine can't run yet.";

/**
 * The Copilot CLI engine's place among the adapters until its own adapter lands: every session on
 * it, started or resumed, is refused in words.
 */
export class UnavailableCopilotCliEngine extends AgentEngine {
  readonly capabilities = UNAVAILABLE_COPILOT_CLI_CAPABILITIES;

  start(): Promise<EngineSession> {
    return Promise.reject(new SessionsNotRunYet(COPILOT_CLI_SESSIONS_REFUSAL));
  }

  resume(): Promise<EngineSession> {
    return Promise.reject(new SessionsNotRunYet(COPILOT_CLI_SESSIONS_REFUSAL));
  }

  readUsageWindows(): Promise<UsageWindows | undefined> {
    return Promise.resolve(undefined);
  }
}
