import type { PathRules } from "./path-rules.js";
import type { ProcessTrees } from "./process-trees.js";
import type { AgentShell, Shell } from "./shell.js";

/**
 * Everything that differs between the operating systems The Office runs on (spec §5.1), with one
 * implementation each for Windows and Linux. Code outside src/platform/os/ asks this, never
 * which system it is.
 */
export interface OperatingSystem {
  /** For messages and telemetry only; a plain string, so nothing outside os/ can branch on it. */
  readonly name: string;
  /** Where the Office data directory lives when OFFICE_DATA_DIR is not set (docs/tasks/build-defaults.md). */
  readonly defaultOfficeDataDirectory: string;
  readonly paths: PathRules;
  /** The shell a Project's commands run in. */
  readonly defaultShell: Shell;
  /** The shells Agents run commands in: PowerShell beside Bash on Windows only (spec §5.4). */
  readonly agentShells: readonly AgentShell[];
  readonly processTrees: ProcessTrees;
  /**
   * Where the user's secrets live that no Agent reads (spec §6): SSH keys, the Claude credentials,
   * the GitHub CLI's and AWS's config, browser profiles. Absolute, files or folders.
   */
  readonly secretPaths: readonly string[];
  /**
   * Where the engine (Claude Code) keeps its temporary files, a background command's output among
   * them, which a session may read (spec §6).
   */
  readonly engineTemporaryFolder: string;
  /**
   * The Claude Code binary the Agent SDK bundles, by the platform package npm installs beside the
   * SDK, as `<package suffix>/<executable>`, in the order the SDK tries them (spec §5.4 Defaults).
   */
  readonly claudeCodeBinaries: readonly string[];
  /** Whether two environment variable names name one variable: Windows ignores their case. */
  sameVariableName(one: string, other: string): boolean;
}

/**
 * The user The Office runs as, read from the process by the caller, so each implementation is a
 * function of it alone and both can be tested on either system.
 */
export interface UserEnvironment {
  readonly variables: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
  /** The numeric user id on Linux; Windows has none. */
  readonly userId?: number | undefined;
}
