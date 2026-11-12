import { homedir } from "node:os";
import { OFFICE_ENV_FILE } from "../../../../platform/config/office-env-file.js";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sessionTemporaryFolder } from "./office-tool-call.js";

/** What differs between the engines in the rules a session is held to. */
export interface EngineRuleParts {
  /** The engine's own folders the session may read, such as its background commands' output. */
  readonly readableFolders: readonly string[];
  /** The variables the session's commands run with, which the rules expand. */
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * The Office rules one session is held to (spec §6): its folder, its skills folder, its temporary
 * folder, where the Office tools write files for it, the engine's own readable folders and those
 * the session is given readable, The Office's own files not; Projects' clones in its data
 * directory are no Office files. A session reaching the workstation is refused the secrets alone.
 */
export function sessionOfficeRules(
  operatingSystem: OperatingSystem,
  officeData: OfficeDataDirectory,
  sessionId: string,
  options: SessionOptions,
  engine: EngineRuleParts,
): OfficeRules {
  return new OfficeRules({
    workingFolder: options.folder,
    readableFolders: [
      ...(options.skills === undefined ? [] : [options.skills.folder]),
      sessionTemporaryFolder(operatingSystem.paths, sessionId),
      ...engine.readableFolders,
      ...(options.readableFolders ?? []),
    ],
    profile: options.profile,
    workstation: options.workstation === true,
    secrets: [...operatingSystem.secretPaths, ...officeSecrets(officeData)],
    readableInSecrets: [{ secret: officeData.folder("engines"), folder: ENGINE_TRANSCRIPTS }],
    officeFiles: [officeData.path],
    cloneFolders: [officeData.folder("repositories")],
    homeFolder: homedir(),
    environment: engine.environment,
    paths: operatingSystem.paths,
    refusalAdvice: options.refusalAdvice,
  });
}

/**
 * The folder of a Claude Code engine's account folder that holds its session transcripts: the one
 * part of it open to a session reaching the workstation (spec §6).
 */
const ENGINE_TRANSCRIPTS = "projects";

/**
 * The Office's secrets: each Claude Code engine's account folder, which holds its credentials, but
 * for its transcripts, the Office identity's folder, which holds its ssh key, and the `.env`
 * holding the database credentials.
 */
function officeSecrets(officeData: OfficeDataDirectory): string[] {
  return [officeData.folder("engines"), officeData.folder("identity"), OFFICE_ENV_FILE];
}
