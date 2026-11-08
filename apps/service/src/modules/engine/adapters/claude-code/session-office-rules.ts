import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import type { OfficeRules } from "../../domain/office-rules.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sessionOfficeRules } from "../office-rules/session-office-rules.js";
import { engineTaskFolder } from "./engine-task-folder.js";
import { sessionEnvironment } from "./session-settings.js";

/** A Claude Code session, as its rules see it. */
export interface ClaudeCodeSessionPlaces {
  readonly sessionId: string;
  /** The engine's config folder the session runs with, which its commands' variables name. */
  readonly configFolder: string;
}

/**
 * The Office rules a Claude Code session is held to: the engine's output of its background
 * commands readable besides the session's own folders, and the variables its commands inherit,
 * the engine's config folder among them, expanded as they run.
 */
export function claudeCodeOfficeRules(
  operatingSystem: OperatingSystem,
  officeData: OfficeDataDirectory,
  { sessionId, configFolder }: ClaudeCodeSessionPlaces,
  options: SessionOptions,
): OfficeRules {
  return sessionOfficeRules(operatingSystem, officeData, sessionId, options, {
    readableFolders: [engineTaskFolder(operatingSystem, options.folder, sessionId)],
    environment: sessionEnvironment(options.environment, configFolder),
  });
}
