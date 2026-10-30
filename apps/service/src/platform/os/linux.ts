import { posix } from "node:path";
import { setTimeout } from "node:timers/promises";
import { runningInGroup } from "./linux-processes.js";
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

export function linux({ variables, homeDirectory, userId }: UserEnvironment): OperatingSystem {
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
    // Named after the user, as the engine names it, in the temporary folder Node's os.tmpdir() gives.
    get engineTemporaryFolder() {
      if (userId === undefined)
        throw new Error("The engine's temporary folder on Linux needs the user's id.");
      return posix.join(variables["TMPDIR"] || "/tmp", `claude-${userId}`);
    },
    // The glibc build first, unless the system has no glibc, as the SDK picks.
    get claudeCodeBinaries() {
      const builds = [`linux-${process.arch}`, `linux-${process.arch}-musl`];
      return (hasGlibc() ? builds : builds.toReversed()).map((build) => `${build}/claude`);
    },
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

function hasGlibc(): boolean {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return report.header?.glibcVersionRuntime !== undefined;
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

async function endGroup(groupId: number): Promise<void> {
  try {
    process.kill(-groupId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return;
  }
  await groupEnded(groupId);
}

const GROUP_END_POLL_MS = 10;
const GROUP_END_TIMEOUT_MS = 5000;

/**
 * Waits until every process of the group has ended. SIGKILL takes effect as each process is next
 * scheduled, not as kill returns, and a killed process stays a zombie until reaped, which counts
 * as ended: it holds no files and runs no code.
 */
async function groupEnded(groupId: number): Promise<void> {
  const deadline = Date.now() + GROUP_END_TIMEOUT_MS;
  for (;;) {
    const running = await runningInGroup(groupId);
    if (running.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Process group ${groupId} still runs ${GROUP_END_TIMEOUT_MS} ms after it was killed: ${running.join(", ")}.`,
      );
    }
    await setTimeout(GROUP_END_POLL_MS);
  }
}
