import { win32 } from "node:path";
import type { OperatingSystem, UserEnvironment } from "./operating-system.js";
import { pathLengthProblem, type PathLimits, type PathRules } from "./path-rules.js";
import type { Shell } from "./shell.js";

/*
 * MAX_PATH is 260 UTF-16 characters with the terminating NUL, and a directory must leave room for
 * an 8.3 file name, so it ends at MAX_PATH minus 12; a name is at most 255. Node itself is not
 * bound by them, but git, cmd.exe and most tools a Project runs are. Source:
 * https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation
 */
const WINDOWS_PATH_LIMITS: PathLimits = {
  pathLength: { file: 259, directory: 247 },
  nameLength: 255,
  unit: "characters",
  separators: /[\\/]/,
  measure: (text) => text.length,
};

export function windows({ variables, homeDirectory }: UserEnvironment): OperatingSystem {
  return {
    name: "Windows",
    defaultOfficeDataDirectory: win32.join(
      variables["LOCALAPPDATA"] || win32.join(homeDirectory, "AppData", "Local"),
      "the-office",
    ),
    paths: windowsPaths,
    defaultShell: commandPrompt(variables),
  };
}

const windowsPaths: PathRules = {
  join: (...segments) => win32.join(...segments),
  pathListSeparator: win32.delimiter,
  lengthProblem: (path, entry) => pathLengthProblem(path, entry, WINDOWS_PATH_LIMITS),
};

function commandPrompt(variables: UserEnvironment["variables"]): Shell {
  // A full path, never a bare "cmd.exe": Windows looks for a bare name in the current directory
  // first, which for a Project's command is a worktree an Agent can write to.
  const file =
    variables["ComSpec"] ||
    win32.join(variables["SystemRoot"] || "C:\\Windows", "System32", "cmd.exe");
  return {
    name: "cmd.exe",
    // As Node's own `shell: true` runs it: /d skips AutoRun commands from the registry, and /s
    // with the outer quotes keeps the command line's own quotes as they are.
    invocation: (commandLine) => ({
      file,
      arguments: ["/d", "/s", "/c", `"${commandLine}"`],
      windowsVerbatimArguments: true,
    }),
  };
}
