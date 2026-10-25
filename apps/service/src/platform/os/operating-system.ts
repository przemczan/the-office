import type { PathRules } from "./path-rules.js";
import type { Shell } from "./shell.js";

/**
 * Everything that differs between the operating systems The Office runs on (spec §5.1), with one
 * implementation each for Windows and Linux. Code outside src/platform/os/ asks this, never
 * which system it is.
 */
export interface OperatingSystem {
  /** For messages and telemetry only. */
  readonly name: "Windows" | "Linux";
  /** Where the Office data directory lives when OFFICE_DATA_DIR is not set (Build defaults in docs/tasks/README.md). */
  readonly defaultOfficeDataDirectory: string;
  readonly paths: PathRules;
  /** The shell a Project's commands run in. */
  readonly defaultShell: Shell;
}

/**
 * The user The Office runs as, read from the process by the caller, so each implementation is a
 * function of it alone and both can be tested on either system.
 */
export interface UserEnvironment {
  readonly variables: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
}
