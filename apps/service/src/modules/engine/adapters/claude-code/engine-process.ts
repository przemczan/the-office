import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";

/** How much of the engine's standard error is kept: its last lines say why it stopped. */
const STDERR_KEPT = 4000;

/** How long a closed engine has to end by itself before The Office ends it. */
const EXIT_GRACE_MS = 10_000;

/** How to start the engine, as the Agent SDK's `spawnClaudeCodeProcess` is asked. */
export interface EngineCommand {
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Ends the engine at once; the SDK aborts only after its graceful close has had its time. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * The engine's process for one session, started so that what it starts can be ended with it: in
 * a process group of its own on Linux, found by its children on Windows (spec §6).
 */
export class EngineProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private exited: Promise<void> = Promise.resolve();
  private stderrTail = "";

  constructor(private readonly processTrees: ProcessTrees) {}

  /** What the end of the engine's standard error said. */
  get stderr(): string {
    return this.stderrTail.trim();
  }

  /** Starts the engine; also the SDK's `spawnClaudeCodeProcess`. */
  readonly spawn = ({
    command,
    args,
    cwd,
    env,
    signal,
  }: EngineCommand): ChildProcessWithoutNullStreams => {
    const child = spawn(command, args, {
      cwd,
      env,
      signal,
      stdio: "pipe",
      detached: this.processTrees.detached,
      windowsHide: true,
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEPT);
    });
    this.exited = new Promise((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    this.child = child;
    return child;
  };

  /**
   * Once the session is closed: waits for the engine to end by itself, ending it if it won't,
   * then ends what it left running, such as a dev server or a watcher.
   */
  async endWithLeftovers(): Promise<void> {
    const processId = this.child?.pid;
    if (processId === undefined) return;
    const exited = await Promise.race([
      this.exited.then(() => true),
      delay(EXIT_GRACE_MS).then(() => false),
    ]);
    if (!exited) await this.processTrees.end(processId);
    await this.processTrees.endLeftovers(processId);
  }
}
