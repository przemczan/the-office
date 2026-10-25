import { spawn, type ChildProcess } from "node:child_process";
import { Injectable } from "@nestjs/common";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { CommandOutcome } from "../../domain/command-run.js";
import {
  CommandRunner,
  type CommandToRun,
  type FinishedCommand,
} from "../../ports/command-runner.js";

/** The end of the output kept in memory; filtering reads its end anyway. */
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
/**
 * How long to read output still on its way once the command has exited. A process it started
 * and left running (a dev server, a build daemon) keeps its pipes open, so they may never close.
 */
const OUTPUT_GRACE_MS = 500;

/** Why The Office ended a command's tree before it exited by itself. */
type EndedBy = "timeout" | "stop";

/** How the shell's process ended. */
type Ending =
  | {
      readonly kind: "exited";
      readonly exitCode: number | null;
      readonly endedBy: EndedBy | undefined;
    }
  | { readonly kind: "not-started" };

/**
 * Runs a command line in the platform's default shell, ending its whole tree when time runs out
 * or it is stopped.
 */
@Injectable()
export class ShellCommandRunner extends CommandRunner {
  private readonly operatingSystem = currentOperatingSystem();

  async run(command: CommandToRun): Promise<FinishedCommand> {
    const startedAt = performance.now();
    const output = new OutputEnd(OUTPUT_LIMIT_BYTES);
    const ending = await this.runToEnd(command, output);
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      outcome: await this.outcomeOf(command, ending),
      exitCode:
        ending.kind === "exited" && ending.endedBy === undefined
          ? (ending.exitCode ?? undefined)
          : undefined,
      durationMs,
      output: output.text(),
    };
  }

  private runToEnd(command: CommandToRun, output: OutputEnd): Promise<Ending> {
    const { defaultShell, processTrees } = this.operatingSystem;
    const invocation = defaultShell.invocation(command.commandLine);
    if (command.signal?.aborted) {
      return Promise.resolve({ kind: "exited", exitCode: null, endedBy: "stop" });
    }
    return new Promise((resolve) => {
      const child = spawn(invocation.file, invocation.arguments, {
        cwd: command.folder,
        env: command.environment,
        stdio: ["ignore", "pipe", "pipe"],
        detached: processTrees.detached,
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
      child.stdout.on("data", (chunk: Buffer) => output.add(chunk));
      child.stderr.on("data", (chunk: Buffer) => output.add(chunk));

      let endedBy: EndedBy | undefined;
      const end = (reason: EndedBy): void => {
        endedBy ??= reason;
        if (child.pid !== undefined) void processTrees.end(child.pid);
      };
      const timer = setTimeout(() => end("timeout"), command.timeoutMs);
      const stop = (): void => end("stop");
      command.signal?.addEventListener("abort", stop, { once: true });
      const stopWatching = (): void => {
        clearTimeout(timer);
        command.signal?.removeEventListener("abort", stop);
      };

      // No shell to start, or no folder to start it in.
      child.once("error", (error) => {
        stopWatching();
        output.add(Buffer.from(`\n${error.message}`));
        resolve({ kind: "not-started" });
      });
      child.once("exit", (exitCode) => {
        stopWatching();
        resolve(afterOutput(child).then(() => ({ kind: "exited", exitCode, endedBy })));
      });
    });
  }

  private async outcomeOf(command: CommandToRun, ending: Ending): Promise<CommandOutcome> {
    if (ending.kind === "not-started") return "could-not-run";
    if (ending.endedBy === "timeout") return "timed-out";
    if (ending.endedBy === "stop") return "stopped";
    if (ending.exitCode === 0) return "passed";
    if (ending.exitCode === null) return "failed";
    const couldNotRun = await this.operatingSystem.defaultShell.couldNotRun({
      commandLine: command.commandLine,
      exitCode: ending.exitCode,
      folder: command.folder,
      environment: command.environment,
    });
    return couldNotRun ? "could-not-run" : "failed";
  }
}

/** Waits for the output pipes to close, or stops reading them after OUTPUT_GRACE_MS. */
function afterOutput(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
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

/** The last bytes a command printed, decoded at the end so no character is cut in two mid-way. */
class OutputEnd {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;

  constructor(private readonly limitBytes: number) {}

  add(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes - (this.chunks[0]?.length ?? 0) >= this.limitBytes) {
      this.bytes -= this.chunks.shift()?.length ?? 0;
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
