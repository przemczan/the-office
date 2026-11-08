import { Injectable } from "@nestjs/common";

/** One Agent Stage run's commands, while it takes them. */
interface RunCommands {
  readonly stop: AbortController;
  readonly running: Set<Promise<unknown>>;
  readonly unlink: () => void;
}

/**
 * The Project commands an Agent runs through an Office tool during its Stage run (spec §6): each
 * gets the run's signal, so none outlives the run. The Agent Stage runner begins a run's commands
 * as its session opens and ends them, whatever ended the Stage, before git is read and the Stage
 * commits; the run's own commands signal (the fire alarm, The Office shutting down) stops them at
 * once too.
 */
@Injectable()
export class StageCommandRuns {
  private readonly byRun = new Map<string, RunCommands>();

  /** Takes the run's commands from now on, stopped as soon as `commandsSignal` is aborted. */
  begin(runId: string, commandsSignal: AbortSignal): void {
    const stop = new AbortController();
    const abort = (): void => stop.abort();
    if (commandsSignal.aborted) abort();
    else commandsSignal.addEventListener("abort", abort, { once: true });
    this.byRun.set(runId, {
      stop,
      running: new Set(),
      unlink: () => commandsSignal.removeEventListener("abort", abort),
    });
  }

  /**
   * Runs `command` as one of the run's, with the signal that stops it when the run ends; undefined,
   * running nothing, when the run takes no commands: it isn't an Agent Stage at work, or it ended.
   */
  async during<Result>(
    runId: string,
    command: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result | undefined> {
    const commands = this.byRun.get(runId);
    if (commands === undefined) return undefined;
    const running = command(commands.stop.signal);
    commands.running.add(running);
    try {
      return await running;
    } finally {
      commands.running.delete(running);
    }
  }

  /**
   * Stops every command of the run, each with everything it started, and waits until all have
   * ended; the run takes no more. Nothing for a run that took none, or ended already.
   */
  async end(runId: string): Promise<void> {
    const commands = this.byRun.get(runId);
    if (commands === undefined) return;
    this.byRun.delete(runId);
    commands.unlink();
    commands.stop.abort();
    await Promise.allSettled(commands.running);
  }
}
