import { chmod } from "node:fs/promises";
import { posix } from "node:path";
import { setTimeout } from "node:timers/promises";
import { codexBuild } from "./codex-build.js";
import { hasProcessEnded, runningDescendants, runningInGroup } from "./linux-processes.js";
import type { OperatingSystem, UserEnvironment } from "./operating-system.js";
import { pathLengthProblem, type PathLimits, type PathRules } from "./path-rules.js";
import { printFileCommand, shQuoted } from "./print-file-command.js";
import type { ProcessTrees } from "./process-trees.js";
import type { AgentShellProgram, Shell } from "./shell.js";

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

export function linux({
  variables,
  homeDirectory,
  userId,
  groupId,
}: UserEnvironment): OperatingSystem {
  const config = configHome(variables["XDG_CONFIG_HOME"], homeDirectory);
  return {
    name: "Linux",
    ...(userId === undefined || groupId === undefined ? {} : { fileOwner: { userId, groupId } }),
    defaultOfficeDataDirectory: posix.join(
      dataHome(variables["XDG_DATA_HOME"], homeDirectory),
      "the-office",
    ),
    paths: linuxPaths,
    defaultShell: bourneShell,
    agentShells: [bash],
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
    // Codex ships one Linux build per processor, linked against musl.
    codexBinary: codexBuild("linux", "unknown-linux-musl", "codex"),
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
    sshPrograms: { ssh: "ssh", keygen: "ssh-keygen", keyscan: "ssh-keyscan" },
    hasLoadAverage: true,
    sameVariableName: (one, other) => one === other,
    printFileCommand: (file) => printFileCommand(shQuoted, file),
    localSocketPath: (name) => posix.join(variables["TMPDIR"] || "/tmp", `${name}.sock`),
    nodeScriptHookCommand: (script, args) =>
      [process.execPath, script, ...args].map(shQuoted).join(" "),
    gitHomeDirectory: (commandVariables) => commandVariables["HOME"] || homeDirectory,
    restrictToOwner: (path, kind) => chmod(path, kind === "folder" ? 0o700 : 0o600),
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

const bash: AgentShellProgram = {
  shell: "bash",
  name: "bash",
  invocation: (commandLine) => ({
    file: "/bin/bash",
    arguments: ["-c", commandLine],
    windowsVerbatimArguments: false,
  }),
};

// A detached process leads a process group of its own, which a negative id signals as a whole;
// the group outlives its leader while any of its processes runs.
const processGroups: ProcessTrees = {
  detached: true,
  end: (processId) => endGroup(processId),
  endLeftovers: (processId) => endGroup(processId),
  endDescendants: (processId) => endDescendants(processId),
};

/**
 * Kills each process the process started, and the group of each that leads one, as a command
 * started in a group or session of its own does; a group none of them leads, such as the
 * service's own when the process isn't detached, is never signalled.
 */
async function endDescendants(processId: number): Promise<void> {
  const found = await runningDescendants(processId);
  const ids = new Set(found.map((one) => one.processId));
  const groups = new Set(found.map((one) => one.groupId).filter((group) => ids.has(group)));
  for (const group of groups) killGone(-group);
  for (const one of found) if (!groups.has(one.groupId)) killGone(one.processId);
  await Promise.all([...groups].map((group) => groupEnded(group)));
  await processesEnded(found.filter((one) => !groups.has(one.groupId)).map((one) => one.processId));
}

/** SIGKILL, a process or group already gone being no error. */
function killGone(target: number): void {
  try {
    process.kill(target, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** Waits until each process has ended, as `groupEnded` waits for a group. */
async function processesEnded(processIds: readonly number[]): Promise<void> {
  const deadline = Date.now() + GROUP_END_TIMEOUT_MS;
  for (;;) {
    const running = (
      await Promise.all(
        processIds.map(async (processId) =>
          (await hasProcessEnded(processId)) ? [] : [processId],
        ),
      )
    ).flat();
    if (running.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Processes ${running.join(", ")} still run ${GROUP_END_TIMEOUT_MS} ms after they were killed.`,
      );
    }
    await setTimeout(GROUP_END_POLL_MS);
  }
}

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
