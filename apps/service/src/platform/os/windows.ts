import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { OperatingSystem, UserEnvironment } from "./operating-system.js";
import { pathLengthProblem, type PathLimits, type PathRules } from "./path-rules.js";
import type { ProcessTrees } from "./process-trees.js";
import type { FailedShellCommand, Shell } from "./shell.js";

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

/** cmd.exe's own commands, which run without a program: when one fails, it ran. */
const CMD_BUILT_INS: ReadonlySet<string> = new Set(
  (
    "assoc break call cd chdir cls color copy date del dir echo endlocal erase exit for ftype " +
    "goto if md mkdir mklink move path pause popd prompt pushd rd rem ren rename rmdir set " +
    "setlocal shift start time title type ver verify vol"
  ).split(" "),
);

/** What cmd.exe tries after a bare program name when PATHEXT is not set. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export function windows({ variables, homeDirectory }: UserEnvironment): OperatingSystem {
  const localAppData = variables["LOCALAPPDATA"] || win32.join(homeDirectory, "AppData", "Local");
  const appData = variables["APPDATA"] || win32.join(homeDirectory, "AppData", "Roaming");
  return {
    name: "Windows",
    defaultOfficeDataDirectory: win32.join(localAppData, "the-office"),
    paths: windowsPaths,
    defaultShell: commandPrompt(variables),
    agentShells: ["bash", "powershell"],
    processTrees: taskkill(variables),
    secretPaths: [
      win32.join(homeDirectory, ".ssh"),
      win32.join(
        variables["CLAUDE_CONFIG_DIR"] || win32.join(homeDirectory, ".claude"),
        ".credentials.json",
      ),
      variables["GH_CONFIG_DIR"] || win32.join(appData, "GitHub CLI"),
      win32.join(homeDirectory, ".aws"),
      win32.join(localAppData, "Google", "Chrome", "User Data"),
      win32.join(localAppData, "Microsoft", "Edge", "User Data"),
      win32.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data"),
      win32.join(localAppData, "Chromium", "User Data"),
      win32.join(appData, "Mozilla", "Firefox", "Profiles"),
      win32.join(appData, "Opera Software"),
    ],
    sameVariableName: (one, other) => one.toUpperCase() === other.toUpperCase(),
  };
}

const windowsPaths: PathRules = {
  join: (...segments) => win32.join(...segments),
  pathListSeparator: win32.delimiter,
  lengthProblem: (path, entry) => pathLengthProblem(path, entry, WINDOWS_PATH_LIMITS),
  resolve: (base, path) => win32.resolve(base, fromGitBash(path)),
  isWithin: (path, folder) => {
    const relative = win32.relative(folder.toLowerCase(), path.toLowerCase());
    return relative.split(win32.sep)[0] !== ".." && !win32.isAbsolute(relative);
  },
  names: (path) =>
    path
      .toLowerCase()
      .split(/[\\/]+/)
      .filter(Boolean),
};

/** Git Bash names drive C: `/c`; Agents' Bash commands on Windows run in it. */
function fromGitBash(path: string): string {
  const drive = /^\/([a-zA-Z])(?=\/|$)/.exec(path);
  return drive === null ? path : `${drive[1]}:${path.slice(2) || "\\"}`;
}

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
    couldNotRun: async (failed) => {
      const program = programOf(failed.commandLine);
      if (program === undefined || CMD_BUILT_INS.has(program.toLowerCase())) return false;
      return !(await anyFileExists(programCandidates(program, failed)));
    },
  };
}

function taskkill(variables: UserEnvironment["variables"]): ProcessTrees {
  // Full paths, for the same reason as cmd.exe's.
  const systemRoot = variables["SystemRoot"] || "C:\\Windows";
  const file = win32.join(systemRoot, "System32", "taskkill.exe");
  const powerShell = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const end = (processId: number): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(
        file,
        ["/pid", String(processId), "/t", "/f"],
        { windowsHide: true },
        // It exits with 128 for a process already gone, and that is no error.
        (error) => (error && typeof error.code !== "number" ? reject(error) : resolve()),
      );
    });
  return {
    // A detached process would get a console window of its own; taskkill finds the tree without.
    detached: false,
    end,
    endLeftovers: async (processId) => {
      for (const child of await childrenOf(powerShell, processId)) await end(child);
    },
  };
}

/**
 * The processes a process started that still run. Windows keeps a process's parent id after the
 * parent ends, so its orphans are found by it; a process started later by another process
 * holding the same id could be found too, which the short time between the end and this read
 * makes unlikely.
 */
function childrenOf(powerShell: string, processId: number): Promise<number[]> {
  const query = `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${processId}' | ForEach-Object { $_.ProcessId }`;
  return new Promise((resolve, reject) => {
    execFile(
      powerShell,
      ["-NoProfile", "-NonInteractive", "-Command", query],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.split(/\s+/).filter(Boolean).map(Number));
        }
      },
    );
  });
}

/**
 * The program a command line starts, as cmd.exe reads it: the first word, or what the first
 * pair of quotes holds. Undefined for a line cmd.exe would read no program from.
 */
export function programOf(commandLine: string): string | undefined {
  const line = commandLine.trim();
  const program = line.startsWith('"')
    ? line.slice(1).split('"')[0]
    : /^[^\s&|<>()]+/.exec(line)?.[0];
  return program || undefined;
}

/**
 * The files cmd.exe would look for to start `program`: in the command's folder and then each
 * PATH folder, with each PATHEXT extension, or at the path given when it names a folder.
 */
export function programCandidates(
  program: string,
  { folder, environment }: Pick<FailedShellCommand, "folder" | "environment">,
): string[] {
  const variable = (name: string): string =>
    Object.entries(environment).find(([key]) => key.toUpperCase() === name)?.[1] ?? "";
  const extensions = ["", ...(variable("PATHEXT") || DEFAULT_PATHEXT).split(";").filter(Boolean)];
  const withExtensions = (path: string): string[] =>
    extensions.map((extension) => `${path}${extension}`);
  if (/[\\/:]/.test(program)) return withExtensions(win32.resolve(folder, program));
  const folders = [
    folder,
    ...variable("PATH")
      .split(";")
      .map((entry) => entry.replaceAll('"', "").trim())
      .filter(Boolean),
  ];
  return folders.flatMap((candidateFolder) => withExtensions(win32.join(candidateFolder, program)));
}

async function anyFileExists(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    if ((await stat(path).catch(() => undefined))?.isFile()) return true;
  }
  return false;
}
