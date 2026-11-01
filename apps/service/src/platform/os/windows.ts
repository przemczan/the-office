import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { OperatingSystem, SshPrograms, UserEnvironment } from "./operating-system.js";
import { pathLengthProblem, type PathLimits, type PathRules } from "./path-rules.js";
import type { ProcessTrees } from "./process-trees.js";
import type { AgentShellProgram, FailedShellCommand, Shell } from "./shell.js";

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
    agentShells: [gitBash(variables), windowsPowerShell(variables)],
    processTrees: taskkill(variables),
    // In the temporary folder Node's os.tmpdir() gives.
    engineTemporaryFolder: win32.join(
      variables["TEMP"] || variables["TMP"] || win32.join(localAppData, "Temp"),
      "claude",
    ),
    claudeCodeBinaries: [`win32-${process.arch}/claude.exe`],
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
    get sshPrograms() {
      return gitForWindowsSsh(variables);
    },
    sameVariableName: (one, other) => one.toUpperCase() === other.toUpperCase(),
    gitHomeDirectory: (commandVariables) => gitForWindowsHome(commandVariables, homeDirectory),
    restrictToOwner: (path, kind) => icaclsOwnerOnly(variables, path, kind),
  };
}

/**
 * Git for Windows' own choice when HOME is unset: `%HOMEDRIVE%%HOMEPATH%` while that folder exists
 * (it may be a network share), else `%USERPROFILE%` (`setup_windows_environment` in its mingw.c).
 */
function gitForWindowsHome(
  variables: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): string {
  const variable = (name: string): string | undefined =>
    Object.entries(variables).find(([key]) => key.toUpperCase() === name)?.[1] || undefined;
  const home = variable("HOME");
  if (home !== undefined) return home;
  const drive = variable("HOMEDRIVE");
  const path = variable("HOMEPATH");
  if (drive !== undefined && path !== undefined && existsSync(`${drive}${path}`)) {
    return `${drive}${path}`;
  }
  return variable("USERPROFILE") ?? homeDirectory;
}

/**
 * The OpenSSH Git for Windows bundles in `usr\bin`, the one its git runs, never the system's own
 * in System32: found beside the git.exe on PATH (`Git\cmd`, `Git\bin` or `Git\mingw64\bin`), else
 * where Git for Windows installs.
 */
function gitForWindowsSsh(variables: UserEnvironment["variables"]): SshPrograms {
  const installed = win32.join(variables["ProgramFiles"] || "C:\\Program Files", "Git");
  const roots = [
    ...foldersHoldingGit(variables).flatMap((folder) => [
      win32.join(folder, ".."),
      win32.join(folder, "..", ".."),
    ]),
    installed,
  ];
  const root =
    roots.find((candidate) => existsSync(win32.join(candidate, "usr", "bin", "ssh.exe"))) ??
    installed;
  const program = (name: string): string => win32.join(root, "usr", "bin", `${name}.exe`);
  return { ssh: program("ssh"), keygen: program("ssh-keygen"), keyscan: program("ssh-keyscan") };
}

/** The PATH folders that hold a git.exe. */
function foldersHoldingGit(variables: UserEnvironment["variables"]): string[] {
  // Windows ignores a variable name's case, and a copied environment keeps whichever it had.
  const path = Object.entries(variables).find(([name]) => name.toUpperCase() === "PATH")?.[1];
  return (path ?? "")
    .split(";")
    .map((entry) => entry.replaceAll('"', "").trim())
    .filter((folder) => folder !== "" && existsSync(win32.join(folder, "git.exe")));
}

/**
 * Replaces the inherited access list with full control for the user alone; a folder's entry is
 * inherited by what it holds.
 */
function icaclsOwnerOnly(
  variables: UserEnvironment["variables"],
  path: string,
  kind: "file" | "folder",
): Promise<void> {
  const file = win32.join(variables["SystemRoot"] || "C:\\Windows", "System32", "icacls.exe");
  const user = variables["USERDOMAIN"]
    ? `${variables["USERDOMAIN"]}\\${variables["USERNAME"] ?? ""}`
    : (variables["USERNAME"] ?? "");
  const access = kind === "folder" ? "(OI)(CI)(F)" : "(F)";
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [path, "/inheritance:r", "/grant:r", `${user}:${access}`],
      { windowsHide: true },
      (error, _stdout, stderr) =>
        error
          ? reject(
              new Error(`icacls could not restrict ${path}: ${stderr.trim()}`, { cause: error }),
            )
          : resolve(),
    );
  });
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

/**
 * Git Bash, found as Claude Code finds it: at CLAUDE_CODE_GIT_BASH_PATH, else beside the git.exe
 * on PATH (`Git\cmd\git.exe` or `Git\bin\git.exe`), else where Git for Windows installs. Never a
 * bash.exe on PATH, which in System32 is WSL's. Looked up on the first command, then kept.
 */
function gitBash(variables: UserEnvironment["variables"]): AgentShellProgram {
  let file: string | undefined;
  return {
    shell: "bash",
    name: "Git Bash",
    invocation: (commandLine) => {
      file ??= gitBashFile(variables);
      return { file, arguments: ["-c", commandLine], windowsVerbatimArguments: false };
    },
  };
}

function gitBashFile(variables: UserEnvironment["variables"]): string {
  const installed = win32.join(
    variables["ProgramFiles"] || "C:\\Program Files",
    "Git",
    "bin",
    "bash.exe",
  );
  const besideGit = foldersHoldingGit(variables).flatMap((folder) => [
    win32.join(folder, "..", "bin", "bash.exe"),
    win32.join(folder, "bash.exe"),
  ]);
  const candidates = [variables["CLAUDE_CODE_GIT_BASH_PATH"], ...besideGit, installed];
  return (
    candidates.find(
      (candidate) => candidate !== undefined && candidate !== "" && existsSync(candidate),
    ) ?? installed
  );
}

/**
 * Windows PowerShell, by its full path. The command line goes in as `-Command`: `-EncodedCommand`
 * would write errors as CLIXML once the output is piped. Its output is set to UTF-8 first.
 */
function windowsPowerShell(variables: UserEnvironment["variables"]): AgentShellProgram {
  const file = win32.join(
    variables["SystemRoot"] || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return {
    shell: "powershell",
    name: "PowerShell",
    invocation: (commandLine) => ({
      file,
      arguments: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; ${commandLine}`,
      ],
      windowsVerbatimArguments: false,
    }),
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
