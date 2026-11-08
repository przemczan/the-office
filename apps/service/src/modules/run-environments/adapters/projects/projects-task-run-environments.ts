import { Injectable, type OnModuleInit } from "@nestjs/common";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  TaskRunEnvironments,
  type FinishedCommand,
  type TaskInRunEnvironment,
  type TaskRunEnvironmentCommand,
  type TaskRunEnvironmentRunner,
} from "../../../projects/index.js";
import { RunEnvironmentFolders } from "../../application/run-environment-folders.js";
import { RunEnvironments, type CommandEnd } from "../../application/run-environments.js";
import { RunEnvironmentRefused } from "../../domain/run-environment-refused.js";
import type { TaskInWorktree } from "../../domain/run-environment.js";
import { KnownTasks } from "../../ports/known-tasks.js";

/** The end of a command's output kept, as the host's shell runner keeps it. */
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

/**
 * Gives Projects the Tasks' run environments, for a Project whose Run environment setting is On:
 * its Script Stages' install and commands run here, their output read back as the host's are.
 */
@Injectable()
export class ProjectsTaskRunEnvironments implements TaskRunEnvironmentRunner, OnModuleInit {
  constructor(
    private readonly registry: TaskRunEnvironments,
    private readonly environments: RunEnvironments,
    private readonly knownTasks: KnownTasks,
    private readonly folders: RunEnvironmentFolders,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async imageOf(task: TaskInRunEnvironment): Promise<string> {
    return this.environments.imageOf(await this.taskInWorktree(task));
  }

  async run(
    task: TaskInRunEnvironment,
    { commandLine, environment, timeoutMs, signal, wait }: TaskRunEnvironmentCommand,
  ): Promise<FinishedCommand> {
    const inWorktree = await this.taskInWorktree(task);
    await mkdir(this.folders.commandOutputs, { recursive: true });
    const folder = await mkdtemp(join(this.folders.commandOutputs, `${task.taskId}-`));
    const outputFile = join(folder, "command.log");
    try {
      const end = await this.environments.run(inWorktree, {
        commandLine,
        environment,
        timeoutMs,
        outputFile,
        startOutputFile: join(folder, "start.log"),
        signal,
        onWaiting: wait?.started,
        onWaitOver: wait?.ended,
      });
      return { ...endOf(end), ...(await outputEndOf(outputFile)) };
    } catch (error) {
      if (error instanceof RunEnvironmentRefused) return await refusedRun(error);
      // A stop while waiting for a slot: nothing ran.
      if (signal?.aborted) return { ...NOTHING_RAN, outcome: "stopped" };
      throw error;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  private async taskInWorktree(task: TaskInRunEnvironment): Promise<TaskInWorktree> {
    const { title } = await this.knownTasks.read(task.taskId);
    return {
      taskId: task.taskId,
      taskTitle: title,
      projectId: task.projectId,
      worktree: task.worktree,
      installCommand: task.installCommand.trim() === "" ? undefined : task.installCommand,
      installInputs: task.installInputs,
    };
  }
}

const NOTHING_RAN = { exitCode: undefined, durationMs: 0, output: "", droppedOutputBytes: 0 };

function endOf({
  exitCode,
  endedBy,
  durationMs,
}: CommandEnd): Omit<FinishedCommand, "output" | "droppedOutputBytes"> {
  if (endedBy === "timeout") return { outcome: "timed-out", exitCode: undefined, durationMs };
  if (endedBy === "stop") return { outcome: "stopped", exitCode: undefined, durationMs };
  return { outcome: exitCode === 0 ? "passed" : "failed", exitCode, durationMs };
}

/**
 * A run environment that couldn't be made or started: the command couldn't run, with what the
 * runtime printed and why last, where a Stage's failure reads it. Never run on the host instead.
 */
async function refusedRun(refused: RunEnvironmentRefused): Promise<FinishedCommand> {
  const printed =
    refused.outputFile === undefined ? undefined : await outputEndOf(refused.outputFile);
  return {
    ...NOTHING_RAN,
    outcome: "could-not-run",
    output: [printed?.output.trimEnd(), ...refused.reasons].filter(Boolean).join("\n"),
    droppedOutputBytes: printed?.droppedOutputBytes ?? 0,
  };
}

/** The last OUTPUT_LIMIT_BYTES of the file, and how much of its start is left out. */
async function outputEndOf(
  file: string,
): Promise<Pick<FinishedCommand, "output" | "droppedOutputBytes">> {
  const handle = await open(file, "r").catch(() => undefined);
  if (handle === undefined) return { output: "", droppedOutputBytes: 0 };
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - OUTPUT_LIMIT_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return { output: buffer.toString("utf8"), droppedOutputBytes: start };
  } finally {
    await handle.close();
  }
}
