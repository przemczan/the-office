import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { BusyWork } from "../../office-updates/index.js";
import { TaskStateChanged } from "../../work/index.js";
import {
  DEFINITION_FOLDER,
  type Reading,
  type RunEnvironmentDefinition,
} from "../domain/run-environment-definition.js";
import { RunEnvironmentCreated, RunEnvironmentRemoved } from "../domain/run-environment-events.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  commandScript,
  composeOverrideOf,
  composeProjectNameOf,
  IDLE_STOP_MS,
  LABEL,
  officeLabels,
  taskLabels,
  type CommandEnvironment,
  type TaskInWorktree,
} from "../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type ComposeProject,
  type ExecutionEnd,
} from "../ports/container-runtime.js";
import { KnownTasks } from "../ports/known-tasks.js";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";
import { readDefinitionIn } from "./definition-files.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";
import { note, RunEnvironmentImages } from "./run-environment-images.js";
import { RunEnvironmentSlots } from "./run-environment-slots.js";

/** The name of the compose file The Office puts over the repository's, in the Task's folder. */
const OVERRIDE_FILE = "office-override.yaml";

/** The states a Task's run environment is removed in (spec §5.5, "Lifecycle"). */
const FINISHED_STATES: readonly string[] = ["done", "dropped"];

/** What a step that may wait for a slot is told, and how it can be stopped. */
export interface SlotOptions {
  /** Called once when every slot is in use, before waiting: "Waiting for a run environment". */
  readonly onWaiting?: () => void;
  readonly signal?: AbortSignal;
}

/** A check to run in a Task's run environment. */
export interface RunEnvironmentCommand extends SlotOptions {
  readonly commandLine: string;
  readonly environment: CommandEnvironment;
  readonly timeoutMs: number;
  /** Where its output goes as it runs, and the run environment's own if it has to start first. */
  readonly outputFile: string;
}

/** A Task's run environment while The Office knows it is running. */
interface RunningEnvironment {
  readonly project: ComposeProject;
  readonly definition: RunEnvironmentDefinition;
  idleStop: Wait | undefined;
}

/**
 * Each Task's run environment (spec §5.5): made from the repository's definition on the Task's
 * first check, kept across its Stages, stopped when idle, and removed when the Task is Done or
 * Dropped. One step at a time per Task, so a check never meets its environment half made.
 */
@Injectable()
export class RunEnvironments implements OnModuleInit {
  private readonly logger = new Logger(RunEnvironments.name);
  private readonly running = new Map<string, RunningEnvironment>();
  /** Each Task's last step, which its next one waits for. */
  private readonly steps = new Map<string, Promise<unknown>>();

  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly images: RunEnvironmentImages,
    private readonly slots: RunEnvironmentSlots,
    private readonly folders: RunEnvironmentFolders,
    private readonly knownTasks: KnownTasks,
    private readonly settings: RunEnvironmentSettings,
    private readonly schedule: Schedule,
    private readonly busyWork: BusyWork,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, ({ taskId, to }) => {
      if (!FINISHED_STATES.includes(to)) return;
      // In the background: the bus waits for its handlers, and the state change for nothing.
      void this.remove(taskId).catch((error: unknown) => {
        this.logger.error(`The run environment of the Task ${taskId} was not removed.`, error);
      });
    });
  }

  /** The Run environment definition in the folder, or every problem with it in the UI's words. */
  definitionOf(folder: string): Promise<Reading<RunEnvironmentDefinition>> {
    return readDefinitionIn(folder);
  }

  /**
   * Makes the Task's run environment ready and running: the image built unless its key has one,
   * the compose project up. A run environment already there is used again.
   */
  prepare(task: TaskInWorktree, outputFile: string, options: SlotOptions = {}): Promise<void> {
    return this.exclusively(task.taskId, () =>
      this.busyWork.during(this.busyItem(task), async () => {
        await this.started(task, outputFile, options);
      }),
    );
  }

  /**
   * Runs the check in the Task's run environment, starting it first if it isn't running, the
   * output streamed to the file; waits for a slot when Run environments at once are all running.
   */
  run(task: TaskInWorktree, command: RunEnvironmentCommand): Promise<ExecutionEnd> {
    return this.exclusively(task.taskId, () =>
      this.busyWork.during(this.busyItem(task), async () => {
        const environment = await this.started(task, command.outputFile, command);
        environment.idleStop?.cancel();
        try {
          return await this.execute(task, environment, command);
        } finally {
          if (this.running.get(task.taskId) === environment) {
            this.stopWhenIdle(task.taskId, environment);
          }
        }
      }),
    );
  }

  /**
   * Runs the check in the service. A runtime failure, such as the service gone, leaves the Task's
   * run environment for the next check to start again, and frees its slot.
   */
  private async execute(
    task: TaskInWorktree,
    environment: RunningEnvironment,
    command: RunEnvironmentCommand,
  ): Promise<ExecutionEnd> {
    try {
      return await this.runtime.exec(
        environment.project,
        {
          service: environment.definition.service,
          ...(environment.definition.user === undefined
            ? {}
            : { user: environment.definition.user }),
          script: commandScript(command.commandLine, task.worktree, command.environment),
          timeoutMs: command.timeoutMs,
          ...(command.signal === undefined ? {} : { signal: command.signal }),
        },
        command.outputFile,
      );
    } catch (error) {
      if (!(error instanceof ContainerRuntimeFailed)) throw error;
      this.running.delete(task.taskId);
      await this.slots.release(task.taskId);
      throw new RunEnvironmentRefused(
        ["The check couldn't run in the run environment.", error.message],
        command.outputFile,
      );
    }
  }

  /** Removes the Task's run environment, its containers, network, volumes and files. */
  remove(taskId: string): Promise<void> {
    this.running.get(taskId)?.idleStop?.cancel();
    return this.exclusively(taskId, async () => {
      // A Task that never had one is left alone, so no runtime is asked for it.
      if (this.running.has(taskId) || (await exists(this.folders.taskFolder(taskId)))) {
        await this.removeNow(taskId);
      }
    });
  }

  /**
   * As The Office starts (spec §5.5, "Lifecycle"): removes what carries this Office's label and no
   * open Task owns, and stops the open Tasks' run environments, which start again at their next
   * check; then the files of Tasks with none, and the images no Project's current key uses.
   */
  async sweep(): Promise<void> {
    const open = new Set(
      (await this.knownTasks.list())
        .filter(({ state }) => !FINISHED_STATES.includes(state))
        .map(({ id }) => id),
    );
    const resources = await this.runtime.listByLabel(officeLabels(this.folders.instance));
    const owners = new Set(resources.map(({ labels }) => labels[LABEL.task] ?? ""));
    owners.delete("");
    for (const taskId of owners) {
      await this.exclusively(taskId, () =>
        open.has(taskId) ? this.stopNow(taskId) : this.removeNow(taskId),
      );
    }
    const folders = await readdir(this.folders.tasks).catch(() => []);
    for (const taskId of folders) {
      if (!open.has(taskId)) await this.exclusively(taskId, () => this.removeNow(taskId));
    }
    await this.images.sweep();
  }

  private async started(
    task: TaskInWorktree,
    outputFile: string,
    options: SlotOptions,
  ): Promise<RunningEnvironment> {
    const known = this.running.get(task.taskId);
    if (known !== undefined) return known;
    const reading = await readDefinitionIn(task.worktree);
    if (reading.value === undefined) throw new RunEnvironmentRefused(reading.problems);
    const definition = reading.value;

    const image = await this.failingAsRefused(
      outputFile,
      "The run environment's image couldn't be built.",
      () => this.images.imageFor(task, definition, outputFile),
    );
    const folder = this.folders.taskFolder(task.taskId);
    const created = !(await exists(folder));
    const project = await this.writeProject(task, definition, image);

    await this.slots.take(task.taskId, options.onWaiting ?? (() => undefined), options.signal);
    try {
      await note(outputFile, `Starting the run environment ${project.name}.`);
      await this.failingAsRefused(outputFile, "The run environment couldn't start.", () =>
        this.runtime.up(project, outputFile),
      );
    } catch (error) {
      await this.slots.release(task.taskId);
      throw error;
    }
    const environment: RunningEnvironment = { project, definition, idleStop: undefined };
    this.running.set(task.taskId, environment);
    this.stopWhenIdle(task.taskId, environment);
    if (created) {
      await this.events.publish(new RunEnvironmentCreated(task.taskId, task.projectId, image));
    }
    return environment;
  }

  /** Writes the Office's compose file over the repository's, for the Task. */
  private async writeProject(
    task: TaskInWorktree,
    definition: RunEnvironmentDefinition,
    image: string,
  ): Promise<ComposeProject> {
    const folder = this.folders.taskFolder(task.taskId);
    await mkdir(folder, { recursive: true });
    const { limits } = await this.settings.read();
    const override = join(folder, OVERRIDE_FILE);
    await writeFile(
      override,
      stringifyYaml(composeOverrideOf(definition, task, image, this.folders.instance, limits)),
    );
    return {
      name: composeProjectNameOf(this.folders.instance, task.taskId),
      files: [...definition.composeFiles.map((file) => join(task.worktree, file)), override],
      projectDirectory: join(task.worktree, DEFINITION_FOLDER),
      services: definition.runServices,
    };
  }

  /** Stops the run environment once no check has run in it for IDLE_STOP_MS, freeing its slot. */
  private stopWhenIdle(taskId: string, environment: RunningEnvironment): void {
    environment.idleStop?.cancel();
    const at = new Date(this.schedule.now().getTime() + IDLE_STOP_MS);
    environment.idleStop = this.schedule.once(`run-environment-idle-${taskId}`, at, () =>
      this.exclusively(taskId, async () => {
        if (this.running.get(taskId) === environment) await this.stopNow(taskId);
      }),
    );
  }

  /** Stops the Task's run environment, keeping its data, and frees its slot. */
  private async stopNow(taskId: string): Promise<void> {
    this.running.get(taskId)?.idleStop?.cancel();
    this.running.delete(taskId);
    try {
      await this.runtime.stop(composeProjectNameOf(this.folders.instance, taskId));
    } finally {
      await this.slots.release(taskId);
    }
  }

  private async removeNow(taskId: string): Promise<void> {
    const environment = this.running.get(taskId);
    this.running.delete(taskId);
    environment?.idleStop?.cancel();
    try {
      await this.runtime.down(composeProjectNameOf(this.folders.instance, taskId));
      await this.runtime.removeByLabel(taskLabels(this.folders.instance, taskId));
      await rm(this.folders.taskFolder(taskId), { recursive: true, force: true });
    } finally {
      await this.slots.release(taskId);
    }
    await this.events.publish(new RunEnvironmentRemoved(taskId));
  }

  private async failingAsRefused<Result>(
    outputFile: string,
    reason: string,
    step: () => Promise<Result>,
  ): Promise<Result> {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof ContainerRuntimeFailed)) throw error;
      throw new RunEnvironmentRefused([reason, error.message], outputFile);
    }
  }

  private exclusively<Result>(taskId: string, step: () => Promise<Result>): Promise<Result> {
    const previous = this.steps.get(taskId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(step);
    const settled = next.catch(() => undefined);
    this.steps.set(taskId, settled);
    void settled.finally(() => {
      if (this.steps.get(taskId) === settled) this.steps.delete(taskId);
    });
    return next;
  }

  private busyItem(task: TaskInWorktree) {
    return {
      kind: "run-environment",
      label: `The run environment of the Task "${task.taskTitle}"`,
    } as const;
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
