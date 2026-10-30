import { homedir } from "node:os";
import { OFFICE_ENV_FILE } from "../../../../platform/config/office-env-file.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { engineTaskFolder } from "./engine-task-folder.js";
import { sessionEnvironment } from "./session-settings.js";

/**
 * The Office rules one session is held to (spec §6): its folder, its skills folder and the
 * engine's output of its background commands readable, The Office's own files not.
 */
export function sessionOfficeRules(
  operatingSystem: OperatingSystem,
  officeDataPath: string,
  sessionId: string,
  options: SessionOptions,
): OfficeRules {
  return new OfficeRules({
    workingFolder: options.folder,
    readableFolders: [
      ...(options.skills === undefined ? [] : [options.skills.folder]),
      engineTaskFolder(operatingSystem, options.folder, sessionId),
    ],
    profile: options.profile,
    userSecrets: operatingSystem.secretPaths,
    officeFiles: [officeDataPath, OFFICE_ENV_FILE],
    homeFolder: homedir(),
    environment: sessionEnvironment(options.environment),
    paths: operatingSystem.paths,
  });
}
