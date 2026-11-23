import type { EngineCapabilities } from "../../ports/agent-engine.js";

/**
 * What a Gemini CLI engine can do, as the engine check's `gemini.*` runs showed it on the headless
 * transport (spec §5.4.7, docs/engine-check.md "Gemini CLI"): no barge-in, as a headless turn takes
 * no input; no language-server tool; no usage windows; a session resumes only in its engine's home.
 */
export const GEMINI_CLI_CAPABILITIES: EngineCapabilities = {
  bargeIn: false,
  interrupt: true,
  resume: true,
  usageWindows: false,
  contextUsage: true,
  officeTools: true,
  outputSchema: true,
  languageServers: false,
  carrySession: false,
  startsUsageWindow: false,
};
