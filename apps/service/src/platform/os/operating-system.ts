import type { PathRules } from "./path-rules.js";
import type { ProcessTrees } from "./process-trees.js";
import type { AgentShellProgram, Shell } from "./shell.js";

/**
 * Everything that differs between the operating systems The Office runs on (spec §5.1), with one
 * implementation each for Windows and Linux. Code outside src/platform/os/ asks this, never
 * which system it is.
 */
export interface OperatingSystem {
  /** For messages and telemetry only; a plain string, so nothing outside os/ can branch on it. */
  readonly name: string;
  /** Where the Office data directory lives when OFFICE_DATA_DIR is not set (AGENTS.md, Project layout and defaults). */
  readonly defaultOfficeDataDirectory: string;
  /**
   * Why The Office can't update itself here, in the UI's words; absent where its launcher updates
   * it (docs/running-the-office.md).
   */
  readonly officeUpdateRefusal?: string;
  readonly paths: PathRules;
  /** The shell a Project's commands run in. */
  readonly defaultShell: Shell;
  /**
   * The shells Agents run commands in: PowerShell beside Bash on Windows only (spec §5.4), with
   * the program each runs a command line in: Git Bash on Windows, as Claude Code finds it.
   */
  readonly agentShells: readonly AgentShellProgram[];
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
  /**
   * The native Codex binary of the pinned `@openai/codex`, in the platform package npm installs
   * beside it, as `<package suffix>/<path in the package>`, as its launcher finds it (spec §5.4
   * Defaults); undefined on a processor Codex has no build for.
   */
  readonly codexBinary: string | undefined;
  /** The OpenSSH programs The Office's git runs: on Windows, the ones Git for Windows bundles. */
  readonly sshPrograms: SshPrograms;
  /** Whether the system reports a load average: Node's `loadavg()` gives zeros on Windows. */
  readonly hasLoadAverage: boolean;
  /** Whether two environment variable names name one variable: Windows ignores their case. */
  sameVariableName(one: string, other: string): boolean;
  /**
   * The home folder git reads the user's global config from, and expands `~` against, for a
   * command run with `variables`.
   */
  gitHomeDirectory(variables: Readonly<Record<string, string | undefined>>): string;
  /**
   * Leaves a file or folder readable and writable by the user The Office runs as only; what a
   * folder holds afterwards starts that way too.
   */
  restrictToOwner(path: string, kind: "file" | "folder"): Promise<void>;
  /**
   * The user and group the files The Office makes belong to, by number: Linux's process ids;
   * absent on Windows, where files carry no numeric owner.
   */
  readonly fileOwner?: FileOwner;
}

/** A file's owner by number, as `chown` takes it. */
export interface FileOwner {
  readonly userId: number;
  readonly groupId: number;
}

/** OpenSSH's programs, each a full path or a name looked up on PATH. */
export interface SshPrograms {
  readonly ssh: string;
  readonly keygen: string;
  readonly keyscan: string;
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
  /** The numeric group id on Linux; Windows has none. */
  readonly groupId?: number | undefined;
}
