import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from "node:child_process";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { ShellProgram } from "../../../../platform/os/shell.js";

/** One command line and where it runs. */
export interface CommandLine {
  readonly commandLine: string;
  readonly folder: string;
  readonly environment: Readonly<Record<string, string>>;
}

/** How to spawn a command line in `shell` so that `ProcessTrees` can end its whole tree. */
export interface ShellSpawn {
  readonly file: string;
  readonly arguments: readonly string[];
  readonly options: SpawnOptionsWithoutStdio;
}

export function shellSpawn(
  shell: ShellProgram,
  processTrees: ProcessTrees,
  command: CommandLine,
): ShellSpawn {
  const invocation = shell.invocation(command.commandLine);
  return {
    file: invocation.file,
    arguments: invocation.arguments,
    options: {
      cwd: command.folder,
      env: command.environment,
      detached: processTrees.detached,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    },
  };
}

/** One command line to run in a shell, in the foreground of a turn. */
export interface ShellCommand extends CommandLine {
  readonly timeoutMs: number;
  /** Ends the command's whole tree when it aborts. */
  readonly signal: AbortSignal;
}

/** How a command ended: by itself with its exit code, or ended by The Office, or never started. */
export type CommandEnding =
  | { readonly kind: "exited"; readonly exitCode: number | null; readonly output: string }
  | { readonly kind: "timed-out"; readonly output: string }
  | { readonly kind: "stopped"; readonly output: string }
  | { readonly kind: "not-started"; readonly problem: string };

/**
 * How long to read output still on its way once the shell has exited. A process it started and
 * left running keeps the pipes open, so they may never close.
 */
const OUTPUT_GRACE_MS = 500;

/**
 * Runs one command line to its end in `shell`, its output and errors in one text as they came,
 * ending the shell with every process it started when the time runs out or `signal` aborts.
 * Whatever it left running when it exited by itself is ended too: a command that should go on
 * runs in the background instead.
 */
export function runShellCommand(
  shell: ShellProgram,
  processTrees: ProcessTrees,
  command: ShellCommand,
): Promise<CommandEnding> {
  if (command.signal.aborted) return Promise.resolve({ kind: "stopped", output: "" });
  const { file, arguments: shellArguments, options } = shellSpawn(shell, processTrees, command);
  return new Promise((resolve) => {
    const child = spawn(file, shellArguments, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const output = (): string => Buffer.concat(chunks).toString("utf8");

    let endedBy: "timed-out" | "stopped" | undefined;
    let ending: Promise<void> = Promise.resolve();
    const end = (reason: "timed-out" | "stopped"): void => {
      if (endedBy !== undefined || child.pid === undefined) return;
      endedBy = reason;
      ending = processTrees.end(child.pid).catch(() => undefined);
    };
    const timer = setTimeout(() => end("timed-out"), command.timeoutMs);
    const stop = (): void => end("stopped");
    command.signal.addEventListener("abort", stop, { once: true });
    const stopWatching = (): void => {
      clearTimeout(timer);
      command.signal.removeEventListener("abort", stop);
    };

    child.once("error", (error) => {
      stopWatching();
      resolve({ kind: "not-started", problem: `${shell.name} could not start: ${error.message}` });
    });
    child.once("exit", (exitCode) => {
      stopWatching();
      const processId = child.pid;
      resolve(
        (async (): Promise<CommandEnding> => {
          await ending;
          if (processId !== undefined && endedBy === undefined) {
            await processTrees.endLeftovers(processId).catch(() => undefined);
          }
          await afterOutput(child);
          if (endedBy !== undefined) return { kind: endedBy, output: output() };
          return { kind: "exited", exitCode, output: output() };
        })(),
      );
    });
  });
}

/** Waits for the output pipes to close, or stops reading them after OUTPUT_GRACE_MS. */
function afterOutput(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.stdout?.closed && child.stderr?.closed) {
      resolve();
      return;
    }
    const giveUp = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve();
    }, OUTPUT_GRACE_MS);
    child.once("close", () => {
      clearTimeout(giveUp);
      resolve();
    });
  });
}
