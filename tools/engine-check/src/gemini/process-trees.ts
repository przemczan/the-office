import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/*
 * How a turn's process is ended with every process it started, as the service's `ProcessTrees`
 * (`apps/service/src/platform/os/`) does it: on Linux the process leads a group of its own
 * (`detached`), which is signalled as a whole; on Windows `taskkill /t /f` ends a tree.
 */

/** Node's spawn option for a turn's process, so its tree can be ended. */
export const DETACHED = process.platform !== "win32";

/**
 * Ends the process and every process it started. A process already gone is no error. On Linux the
 * CLI starts each shell command in a group of its own, which the CLI's group doesn't reach, so its
 * descendants and the groups they lead are ended first, while they can still be found by parent, as
 * the service's `endDescendants` does (`gemini.interrupt`).
 */
export async function endProcessTree(processId: number): Promise<void> {
  if (process.platform === "win32") {
    await taskkill(processId);
    return;
  }
  for (const descendant of await linuxDescendants(processId)) {
    if (descendant.groupId === descendant.pid) signalGroup(descendant.pid);
    else killGone(descendant.pid);
  }
  signalGroup(processId);
}

interface LinuxProcess {
  readonly pid: number;
  readonly parentId: number;
  readonly groupId: number;
}

async function linuxDescendants(processId: number): Promise<LinuxProcess[]> {
  const running = await linuxProcesses();
  const parents = new Set([processId]);
  const found: LinuxProcess[] = [];
  for (let added = true; added;) {
    added = false;
    for (const candidate of running) {
      if (parents.has(candidate.parentId) && !parents.has(candidate.pid)) {
        parents.add(candidate.pid);
        found.push(candidate);
        added = true;
      }
    }
  }
  return found;
}

async function linuxProcesses(): Promise<LinuxProcess[]> {
  const found: LinuxProcess[] = [];
  for (const entry of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
    const stat = await readFile(join("/proc", entry, "stat"), "utf8").catch(() => "");
    // Fields after the command name, which is in parentheses and may hold spaces: state, ppid, pgrp.
    const [, parentId, groupId] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (parentId !== undefined && groupId !== undefined) {
      found.push({ pid: Number(entry), parentId: Number(parentId), groupId: Number(groupId) });
    }
  }
  return found;
}

function killGone(processId: number): void {
  try {
    process.kill(processId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** Ends what a process that ended by itself left running: its group, or on Windows its children's trees. */
export async function endLeftovers(processId: number): Promise<void> {
  if (process.platform === "win32") {
    for (const child of await childrenOf(processId)) await taskkill(child);
    return;
  }
  signalGroup(processId);
}

/** The ids of the running processes whose command line holds `text`, this one left out. */
export async function processesNaming(text: string): Promise<number[]> {
  const commandLines =
    process.platform === "win32" ? await windowsCommandLines() : await linuxCommandLines();
  return commandLines
    .filter(({ pid, commandLine }) => pid !== process.pid && commandLine.includes(text))
    .map(({ pid }) => pid);
}

function signalGroup(processId: number): void {
  try {
    process.kill(-processId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function taskkill(processId: number): Promise<void> {
  // It exits non-zero for a process already gone, and that is no error.
  await execFileAsync("taskkill", ["/pid", String(processId), "/t", "/f"], {
    windowsHide: true,
  }).catch(() => undefined);
}

async function childrenOf(processId: number): Promise<number[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${processId}" | ForEach-Object { $_.ProcessId }`,
    ],
    { windowsHide: true },
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line, 10))
    .filter((pid) => Number.isInteger(pid));
}

interface CommandLine {
  readonly pid: number;
  readonly commandLine: string;
}

async function linuxCommandLines(): Promise<CommandLine[]> {
  const entries = await readdir("/proc");
  const found: CommandLine[] = [];
  for (const entry of entries.filter((name) => /^\d+$/.test(name))) {
    const commandLine = await readFile(join("/proc", entry, "cmdline"), "utf8").catch(() => "");
    if (commandLine !== "") {
      found.push({ pid: Number(entry), commandLine: commandLine.replaceAll("\0", " ") });
    }
  }
  return found;
}

async function windowsCommandLines(): Promise<CommandLine[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.split(/\r?\n/).flatMap((line) => {
    const tab = line.indexOf("\t");
    const pid = Number.parseInt(line.slice(0, tab), 10);
    return tab === -1 || !Number.isInteger(pid) ? [] : [{ pid, commandLine: line.slice(tab + 1) }];
  });
}
