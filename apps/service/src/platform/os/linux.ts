import { posix } from "node:path";
import type { OperatingSystem, UserEnvironment } from "./operating-system.js";
import { pathLengthProblem, type PathLimits, type PathRules } from "./path-rules.js";
import type { ProcessTrees } from "./process-trees.js";
import type { Shell } from "./shell.js";

/** What POSIX sh exits with when it can't run a command: 126 not executable, 127 not found. */
const COULD_NOT_RUN_EXIT_CODES: ReadonlySet<number> = new Set([126, 127]);

// PATH_MAX is 4096 bytes with the terminating NUL and NAME_MAX 255 bytes (linux/limits.h).
const LINUX_PATH_LIMITS: PathLimits = {
  pathLength: { file: 4095, directory: 4095 },
  nameLength: 255,
  unit: "bytes",
  separators: /\//,
  measure: (text) => Buffer.byteLength(text, "utf8"),
};

export function linux({ variables, homeDirectory }: UserEnvironment): OperatingSystem {
  const config = configHome(variables["XDG_CONFIG_HOME"], homeDirectory);
  return {
    name: "Linux",
    defaultOfficeDataDirectory: posix.join(
      dataHome(variables["XDG_DATA_HOME"], homeDirectory),
      "the-office",
    ),
    paths: linuxPaths,
    defaultShell: bourneShell,
    agentShells: ["bash"],
    processTrees: processGroups,
    secretPaths: [
      posix.join(homeDirectory, ".ssh"),
      posix.join(
        variables["CLAUDE_CONFIG_DIR"] || posix.join(homeDirectory, ".claude"),
        ".credentials.json",
      ),
      variables["GH_CONFIG_DIR"] || posix.join(config, "gh"),
      posix.join(homeDirectory, ".aws"),
      posix.join(config, "google-chrome"),
      posix.join(config, "chromium"),
      posix.join(config, "microsoft-edge"),
      posix.join(config, "BraveSoftware"),
      posix.join(homeDirectory, ".mozilla", "firefox"),
      posix.join(homeDirectory, "snap", "firefox"),
    ],
    sameVariableName: (one, other) => one === other,
  };
}

// The XDG Base Directory spec says a relative XDG_DATA_HOME is invalid and is to be ignored.
function dataHome(xdgDataHome: string | undefined, homeDirectory: string): string {
  return xdgDataHome && posix.isAbsolute(xdgDataHome)
    ? xdgDataHome
    : posix.join(homeDirectory, ".local", "share");
}

// The same rule holds for XDG_CONFIG_HOME.
function configHome(xdgConfigHome: string | undefined, homeDirectory: string): string {
  return xdgConfigHome && posix.isAbsolute(xdgConfigHome)
    ? xdgConfigHome
    : posix.join(homeDirectory, ".config");
}

const linuxPaths: PathRules = {
  join: (...segments) => posix.join(...segments),
  pathListSeparator: posix.delimiter,
  lengthProblem: (path, entry) => pathLengthProblem(path, entry, LINUX_PATH_LIMITS),
  resolve: (base, path) => posix.resolve(base, path),
  isWithin: (path, folder) => {
    const relative = posix.relative(folder, path);
    return relative.split(posix.sep)[0] !== ".." && !posix.isAbsolute(relative);
  },
  names: (path) => path.split("/").filter(Boolean),
};

const bourneShell: Shell = {
  name: "sh",
  invocation: (commandLine) => ({
    file: "/bin/sh",
    arguments: ["-c", commandLine],
    windowsVerbatimArguments: false,
  }),
  couldNotRun: ({ exitCode }) => Promise.resolve(COULD_NOT_RUN_EXIT_CODES.has(exitCode)),
};

// A detached process leads a process group of its own, which a negative id signals as a whole;
// the group outlives its leader while any of its processes runs.
const processGroups: ProcessTrees = {
  detached: true,
  end: (processId) => endGroup(processId),
  endLeftovers: (processId) => endGroup(processId),
};

function endGroup(groupId: number): Promise<void> {
  try {
    process.kill(-groupId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  return Promise.resolve();
}
