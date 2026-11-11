import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import type { PathRules } from "../../../../platform/os/path-rules.js";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { ShellProgram } from "../../../../platform/os/shell.js";
import type {
  BackgroundEnding,
  ProcessEndedEvent,
  ProcessOutputEvent,
  ProcessStartedEvent,
} from "../../ports/session-events.js";
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

/** What the session is told of its Processes (spec 2.9). */
export type ProcessEvent = ProcessStartedEvent | ProcessOutputEvent | ProcessEndedEvent;

/** Who The Office ended a command for: the Agent's TaskStop, an interrupt or the session's end. */
type StoppedBy = Extract<BackgroundEnding, { state: "stopped" }>["by"];

/** How often a running command's output file is read for new output, as the SDK's are. */
export const OUTPUT_READ_INTERVAL_MS = 500;

/** How much of an output file one read takes at most. */
const READ_CHUNK_BYTES = 64 * 1024;

interface RunningCommand {
  readonly id: string;
  /** The id of the call that started it, which its Process is known by. */
  readonly callId: string;
  readonly outputFile: string;
  readonly commandLine: string;
  /** What the call said the command does, or its command line, as the notice of its end names it. */
  readonly description: string;
  readonly processId: number;
  /** Settles once the shell has exited, its leftovers are ended and its end is reported. */
  readonly exited: Promise<void>;
  exitCode: number | null | undefined;
  /** Set once The Office began ending it, so its exit doesn't end leftovers a second time. */
  ending: Promise<void> | undefined;
  /** Who The Office ended it for; the first one counts. */
  stoppedBy: StoppedBy | undefined;
  readonly output: OutputReader;
}

/**
 * A session's commands run in the background, as the SDK's sessions run them: each writes its
 * output and errors to `<id>.output` in the session's folder for them, and runs on past its turn
 * until it exits, TaskStop stops it, or `endAll` ends it with every process it started. Each is
 * reported as a Process: its start, its output read from that file every half second, and its
 * end, after a last read.
 */
export class BackgroundCommands {
  private readonly commands = new Map<string, RunningCommand>();
  /** The notices of commands that ended by themselves, not yet given to the model. */
  private readonly notices: string[] = [];
  private report: (event: ProcessEvent) => void = () => undefined;

  constructor(
    readonly folder: string,
    private readonly processTrees: ProcessTrees,
    private readonly paths: PathRules,
    private readonly readIntervalMs = OUTPUT_READ_INTERVAL_MS,
  ) {}

  /** Where the Processes' events go, between turns too: the session's event channel. */
  reportTo(report: (event: ProcessEvent) => void): void {
    this.report = report;
  }

  /**
   * Starts `command` for the call `callId`; `description` names it in the notice of its end and
   * in its Process.
   */
  async start(
    shell: ShellProgram,
    command: CommandLine,
    description: string,
    callId: string,
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
    this.report({
      kind: "process-started",
      callId,
      engineTaskId: id,
      withinToolCall: undefined,
      commandLine: command.commandLine,
      description,
    });
    this.commands.set(
      id,
      this.watched(child, {
        id,
        callId,
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
    await this.end(command, "agent");
    return { kind: "stopped", commandLine: command.commandLine };
  }

  /**
   * The notices of the commands that ended by themselves since the last call, as Claude Code tells
   * its model of them; a command TaskStop or `endAll` ended has none.
   */
  takeNotices(): string[] {
    return this.notices.splice(0);
  }

  /**
   * Ends every command still running, each with every process it started; on an interrupt unless
   * `by` says otherwise. Returns once each one's end is reported.
   */
  async endAll(by: StoppedBy = "interrupt"): Promise<void> {
    await Promise.all(
      [...this.commands.values()].map((command) =>
        command.exitCode === undefined ? this.end(command, by) : command.exited,
      ),
    );
  }

  /**
   * Ends every command and removes their output, when the session ends; each one's end is
   * reported before it returns. Windows may hold a file an ended process wrote a little longer;
   * output left in the temporary folder then is no harm.
   */
  async close(): Promise<void> {
    await this.endAll("session-end");
    await rm(this.folder, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }

  private watched(
    child: ChildProcess,
    started: Pick<
      RunningCommand,
      "id" | "callId" | "outputFile" | "commandLine" | "description" | "processId"
    >,
  ): RunningCommand {
    let exited!: () => void;
    const command: RunningCommand = {
      ...started,
      exited: new Promise((resolve) => (exited = resolve)),
      exitCode: undefined,
      ending: undefined,
      stoppedBy: undefined,
      output: new OutputReader(started.outputFile, (text) =>
        this.report({ kind: "process-output", callId: started.callId, text }),
      ),
    };
    // Unref'd: a command running on keeps no service alive by its reads.
    const reads = setInterval(() => command.output.readIfIdle(), this.readIntervalMs);
    reads.unref();
    // Ending a tree that is already gone can make the child report an error; nothing is lost.
    child.on("error", () => undefined);
    child.once("exit", (exitCode) => {
      command.exitCode = exitCode;
      // As in the foreground, what a command leaves running once it exits by itself is ended:
      // later its id may be another process's.
      const ended =
        command.ending ?? this.processTrees.endLeftovers(command.processId).catch(() => undefined);
      void ended.then(() => this.finished(command, exitCode, reads)).finally(exited);
    });
    return command;
  }

  /** Tells of a command's end, once whatever it started has ended. */
  private async finished(
    command: RunningCommand,
    exitCode: number | null,
    reads: NodeJS.Timeout,
  ): Promise<void> {
    // The model's notice as soon as it can land, as before the Process was reported.
    if (command.ending === undefined) this.notices.push(endedNotice(command, exitCode));
    // Once nothing it started writes any more, so the last read takes all it wrote.
    clearInterval(reads);
    await command.output.readToEnd();
    this.report({
      kind: "process-ended",
      callId: command.callId,
      ending: endingOf(command.stoppedBy, exitCode),
      exitCode: exitCode ?? undefined,
    });
  }

  private async end(command: RunningCommand, by: StoppedBy): Promise<void> {
    command.stoppedBy ??= by;
    command.ending ??= this.processTrees.end(command.processId).catch(() => undefined);
    await command.ending;
    await command.exited;
  }
}

/**
 * Reads what a command wrote to its output file since the last read, by bytes from the offset
 * already read, one read at a time. The decoder keeps a character split between two reads until
 * its last bytes come.
 */
class OutputReader {
  private offset = 0;
  private readonly decoder = new StringDecoder("utf8");
  private reading: Promise<void> = Promise.resolve();
  private busy = false;

  constructor(
    private readonly file: string,
    private readonly read: (text: string) => void,
  ) {}

  /** A timer's read, skipped while the last one is still reading. */
  readIfIdle(): void {
    if (!this.busy) void this.next();
  }

  /** The last read, after any under way, with whatever the decoder still held. */
  async readToEnd(): Promise<void> {
    await this.next();
    const rest = this.decoder.end();
    if (rest !== "") this.read(rest);
  }

  private next(): Promise<void> {
    this.busy = true;
    this.reading = this.reading
      .then(() => this.readNew())
      // A file gone or unreadable has nothing more to give.
      .catch(() => undefined)
      .finally(() => (this.busy = false));
    return this.reading;
  }

  private async readNew(): Promise<void> {
    const handle = await open(this.file, "r");
    let text = "";
    try {
      const buffer = Buffer.alloc(READ_CHUNK_BYTES);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        text += this.decoder.write(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    if (text !== "") this.read(text);
  }
}

/** How a command ended, as its Process is told: stopped by whoever ended it, else by its exit. */
function endingOf(stoppedBy: StoppedBy | undefined, exitCode: number | null): BackgroundEnding {
  if (stoppedBy !== undefined) return { state: "stopped", by: stoppedBy };
  if (exitCode === 0) return { state: "finished" };
  return {
    state: "failed",
    reason: exitCode === null ? "Ended by a signal" : `Exited with code ${exitCode}`,
  };
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
