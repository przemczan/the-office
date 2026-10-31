import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { PathRules } from "../../../../platform/os/path-rules.js";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { ShellProgram } from "../../../../platform/os/shell.js";
import { shellSpawn, type CommandLine } from "./shell-command.js";

/** How a command meant to run in the background began. */
export type BackgroundStart =
  | { readonly kind: "started"; readonly id: string; readonly outputFile: string }
  | { readonly kind: "not-started"; readonly problem: string };

/** What TaskStop found: the command stopped, or none running by that id. */
export type BackgroundStop =
  | { readonly kind: "stopped"; readonly commandLine: string }
  | { readonly kind: "not-running"; readonly exitCode: number | null }
  | { readonly kind: "unknown" };

interface RunningCommand {
  readonly id: string;
  readonly outputFile: string;
  readonly commandLine: string;
  /** What the call said the command does, or its command line, as the notice of its end names it. */
  readonly description: string;
  readonly processId: number;
  /** Settles once the shell has exited and whatever it left running has been ended. */
  readonly exited: Promise<void>;
  exitCode: number | null | undefined;
  /** Set once The Office began ending it, so its exit doesn't end leftovers a second time. */
  ending: Promise<void> | undefined;
}

/**
 * Where a session of the loop writes its background commands' output: a folder of its own, which
 * its Office rules let it read as the SDK's sessions read theirs (spec §6).
 */
export function backgroundCommandFolder(paths: PathRules, sessionId: string): string {
  return paths.join(tmpdir(), "office-sessions", sessionId);
}

/**
 * A session's commands run in the background, as the SDK's sessions run them: each writes its
 * output and errors to `<id>.output` in the session's folder for them, and runs on past its turn
 * until it exits, TaskStop stops it, or `endAll` ends it with every process it started.
 */
export class BackgroundCommands {
  private readonly commands = new Map<string, RunningCommand>();
  /** The notices of commands that ended by themselves, not yet given to the model. */
  private readonly notices: string[] = [];

  constructor(
    readonly folder: string,
    private readonly processTrees: ProcessTrees,
    private readonly paths: PathRules,
  ) {}

  /** Starts `command`; `description` names it in the notice of its end. */
  async start(
    shell: ShellProgram,
    command: CommandLine,
    description: string,
  ): Promise<BackgroundStart> {
    const id = commandId();
    const outputFile = this.paths.join(this.folder, `${id}.output`);
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const output = await open(outputFile, "w");
    let child: ChildProcess;
    let started: Promise<string | undefined>;
    try {
      const {
        file,
        arguments: shellArguments,
        options,
      } = shellSpawn(shell, this.processTrees, command);
      child = spawn(file, shellArguments, { ...options, stdio: ["ignore", output.fd, output.fd] });
      // Watched before anything is awaited, as the child reports its start on the next tick.
      started = spawned(child);
    } finally {
      // The child holds its own copy of the file.
      await output.close();
    }
    const problem = await started;
    if (problem !== undefined || child.pid === undefined) {
      return {
        kind: "not-started",
        problem: `${shell.name} could not start: ${problem ?? "it has no process id"}`,
      };
    }
    this.commands.set(
      id,
      this.watched(child, {
        id,
        outputFile,
        commandLine: command.commandLine,
        description,
        processId: child.pid,
      }),
    );
    return { kind: "started", id, outputFile };
  }

  /** Ends the command `id` with every process it started, as TaskStop asks. */
  async stop(id: string): Promise<BackgroundStop> {
    const command = this.commands.get(id);
    if (command === undefined) return { kind: "unknown" };
    if (command.exitCode !== undefined || command.ending !== undefined) {
      await command.exited;
      return { kind: "not-running", exitCode: command.exitCode ?? null };
    }
    await this.end(command);
    return { kind: "stopped", commandLine: command.commandLine };
  }

  /**
   * The notices of the commands that ended by themselves since the last call, as Claude Code tells
   * its model of them; a command TaskStop or `endAll` ended has none.
   */
  takeNotices(): string[] {
    return this.notices.splice(0);
  }

  /** Ends every command still running, each with every process it started. */
  async endAll(): Promise<void> {
    await Promise.all(
      [...this.commands.values()].map((command) =>
        command.exitCode === undefined ? this.end(command) : command.exited,
      ),
    );
  }

  /**
   * Ends every command and removes their output, when the session ends. Windows may hold a file
   * an ended process wrote a little longer; output left in the temporary folder then is no harm.
   */
  async close(): Promise<void> {
    await this.endAll();
    await rm(this.folder, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }

  private watched(
    child: ChildProcess,
    started: Pick<
      RunningCommand,
      "id" | "outputFile" | "commandLine" | "description" | "processId"
    >,
  ): RunningCommand {
    let exited!: () => void;
    const command: RunningCommand = {
      ...started,
      exited: new Promise((resolve) => (exited = resolve)),
      exitCode: undefined,
      ending: undefined,
    };
    // Ending a tree that is already gone can make the child report an error; nothing is lost.
    child.on("error", () => undefined);
    child.once("exit", (exitCode) => {
      command.exitCode = exitCode;
      if (command.ending !== undefined) {
        void command.ending.then(exited);
        return;
      }
      // As in the foreground, what a command leaves running once it exits by itself is ended:
      // later its id may be another process's.
      void this.endedByItself(command, exitCode).then(exited);
    });
    return command;
  }

  private async endedByItself(command: RunningCommand, exitCode: number | null): Promise<void> {
    await this.processTrees.endLeftovers(command.processId).catch(() => undefined);
    this.notices.push(endedNotice(command, exitCode));
  }

  private async end(command: RunningCommand): Promise<void> {
    command.ending ??= this.processTrees.end(command.processId).catch(() => undefined);
    await command.ending;
    await command.exited;
  }
}

/** Claude Code's notice of a background command's end, which the model reads as a user message. */
function endedNotice(command: RunningCommand, exitCode: number | null): string {
  const completed = exitCode === 0;
  const ending = completed
    ? "completed (exit code 0)"
    : `failed${exitCode === null ? "" : ` with exit code ${exitCode}`}`;
  return [
    "<task-notification>",
    `<task-id>${command.id}</task-id>`,
    `<output-file>${command.outputFile}</output-file>`,
    `<status>${completed ? "completed" : "failed"}</status>`,
    `<summary>Background command "${command.description}" ${ending}</summary>`,
    "</task-notification>",
  ].join("\n");
}

/** Resolves once the child has started, or with the reason it couldn't. */
function spawned(child: ChildProcess): Promise<string | undefined> {
  return new Promise((resolve) => {
    child.once("spawn", () => resolve(undefined));
    child.once("error", (error) => resolve(error.message));
  });
}

/** A short id like the SDK's, which the model names to TaskStop. */
function commandId(): string {
  return `b${randomBytes(4).toString("hex")}`;
}
