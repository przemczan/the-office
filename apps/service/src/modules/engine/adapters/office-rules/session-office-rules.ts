import { homedir } from "node:os";
import { OFFICE_ENV_FILE } from "../../../../platform/config/office-env-file.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { SessionOptions } from "../../ports/session-options.js";

/** What differs between the engines in the rules a session is held to. */
export interface EngineRuleParts {
  /** The engine's own folders the session may read, such as its background commands' output. */
  readonly readableFolders: readonly string[];
  /** The variables the session's commands run with, which the rules expand. */
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * The Office rules one session is held to (spec §6): its folder, its skills folder and the
 * engine's own readable folders readable, The Office's own files not.
 */
export function sessionOfficeRules(
  operatingSystem: OperatingSystem,
  officeDataPath: string,
  options: SessionOptions,
  engine: EngineRuleParts,
): OfficeRules {
  return new OfficeRules({
    workingFolder: options.folder,
    readableFolders: [
      ...(options.skills === undefined ? [] : [options.skills.folder]),
      ...engine.readableFolders,
    ],
    profile: options.profile,
    userSecrets: operatingSystem.secretPaths,
    officeFiles: [officeDataPath, OFFICE_ENV_FILE],
    homeFolder: homedir(),
    environment: engine.environment,
    paths: operatingSystem.paths,
  });
}
