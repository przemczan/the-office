import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import type { CommandRunner, FinishedCommand } from "../ports/command-runner.js";
import { commandEnvironment } from "./command-environment.js";
import {
  TaskRunEnvironments,
  type TaskInRunEnvironment,
  type TaskRunEnvironmentCommand,
  type TaskRunEnvironmentRunner,
} from "./task-run-environments.js";

/**
 * Run environments as a test scripts them: each command runs in the Task's worktree with only the
 * Project's variables and PATH, as it would in a container, and is recorded; one may wait for a
 * free run environment first, or find none can start.
 */
export class ScriptedTaskRunEnvironments implements TaskRunEnvironmentRunner {
  /** Every command given, in order, with its Task. */
  readonly runs: { task: TaskInRunEnvironment; command: TaskRunEnvironmentCommand }[] = [];
  /** Every Task started with no command, in order. */
  readonly starts: TaskInRunEnvironment[] = [];
  image = "the-office/shop:first-key";
  /** Set for the next commands to find their run environment can't start, for this reason. */
  refusal: string | undefined = undefined;
  /** Set for the next command to wait for a free run environment until this resolves. */
  waitsUntil: Promise<void> | undefined = undefined;

  /** `shell` runs the commands, as the run environment's own shell would. */
  constructor(private readonly shell: CommandRunner) {}

  /** A registry with these run environments in it, as Run environments fills Projects'. */
  registry(): TaskRunEnvironments {
    const registry = new TaskRunEnvironments();
    registry.register(this);
    return registry;
  }

  imageOf(): Promise<string> {
    return Promise.resolve(this.image);
  }

  async run(
    task: TaskInRunEnvironment,
    command: TaskRunEnvironmentCommand,
  ): Promise<FinishedCommand> {
    this.runs.push({ task, command });
    if (this.refusal !== undefined) {
      return { ...NOTHING_RAN, outcome: "could-not-run", output: this.refusal };
    }
    const turn = this.waitsUntil;
    this.waitsUntil = undefined;
    if (turn !== undefined && !(await waited(turn, command))) {
      return { ...NOTHING_RAN, outcome: "stopped" };
    }
    return this.shell.run({
      commandLine: command.commandLine,
      folder: task.worktree,
      environment: commandEnvironment(
        { PATH: process.env["PATH"] },
        command.environment,
        currentOperatingSystem(),
      ),
      timeoutMs: command.timeoutMs,
      signal: command.signal,
      outputFile: command.outputFile,
    });
  }

  start(task: TaskInRunEnvironment): Promise<readonly string[]> {
    this.starts.push(task);
    return Promise.resolve(this.refusal === undefined ? [] : [this.refusal]);
  }
}

const NOTHING_RAN = { exitCode: undefined, durationMs: 0, output: "", droppedOutputBytes: 0 };

/** Whether the wait ended in the command's turn, not in a stop; the wait told either way. */
async function waited(turn: Promise<void>, { signal, wait }: TaskRunEnvironmentCommand) {
  await wait?.started();
  const stopped = new Promise<false>((resolve) => {
    if (signal?.aborted) resolve(false);
    signal?.addEventListener("abort", () => resolve(false), { once: true });
  });
  try {
    return await Promise.race([turn.then(() => true), stopped]);
  } finally {
    await wait?.ended();
  }
}
