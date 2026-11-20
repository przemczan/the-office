import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  commandVariables,
  composeOverrideOf,
  composeProjectNameOf,
  handBackScript,
  IDLE_STOP_MS,
  LABEL,
  officeLabels,
  taskLabels,
  type CommandEnvironment,
  type FileOwnerIds,
  type TaskInWorktree,
} from "../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type ComposeProject,
  type ExecutionEnd,
  type StreamedOutputMask,
} from "../ports/container-runtime.js";
import { KnownTasks } from "../ports/known-tasks.js";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";
import { readDefinitionIn } from "./definition-files.js";
import { HostCores } from "./host-cores.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";
import { note, RunEnvironmentImages } from "./run-environment-images.js";
import { RunEnvironmentSlots } from "./run-environment-slots.js";
import { ServiceOwner } from "./service-owner.js";

/** The name of the compose file The Office puts over the repository's, in the Task's folder. */
const OVERRIDE_FILE = "office-override.yaml";

/** The states a Task's run environment is removed in (spec §5.5, "Lifecycle"). */
const FINISHED_STATES: readonly string[] = ["done", "dropped"];

/** Who the hand-back runs as in the checks' service: root, whatever user the image names. */
const ROOT_USER = "0:0";

/** How long giving a check's files back may take: a worktree's node_modules can be large. */
const HAND_BACK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * What a step that may wait for a slot is told, and how it can be stopped. A hook that fails is
 * logged, never thrown, so a slot taken is never left held by a step that didn't run.
 */
export interface SlotOptions {
  /** Called once when every slot is in use, before waiting: "Waiting for a run environment". */
  readonly onWaiting?: () => void | Promise<void>;
  /** Called once the wait `onWaiting` told of is over, taken or given up, after it. */
  readonly onWaitOver?: () => void | Promise<void>;
  /** Ends a wait at once, the step throwing; a check it reaches is stopped. */
  readonly signal?: AbortSignal;
}

/** A check to run in a Task's run environment. */
export interface RunEnvironmentCommand extends SlotOptions {
  readonly commandLine: string;
  readonly environment: CommandEnvironment;
  /** Hides the Project's Secret variables in what reaches `outputFile`. */
  readonly mask: StreamedOutputMask;
  /** Counted from when the check starts, never from a wait for a slot before it. */
  readonly timeoutMs: number;
  /** Where its output goes as it runs. */
  readonly outputFile: string;
  /** Where the run environment's own output goes if it has to start first; else `outputFile`. */
  readonly startOutputFile?: string;
  /**
   * A condition command, which reads the file in the Task's Stage runs' folder: refused, with
   * nothing run, by a run environment already running without that folder mounted.
   */
  readonly readsStageRuns?: boolean;
}

/** Why a condition command isn't run in a run environment started without the Stage runs' folder. */
export const STAGE_RUNS_NOT_MOUNTED =
  "The run environment started before condition commands could read their file; stop and start the Task's run environment.";

/** How a check ended, and how long it ran, from its start in the service. */
export interface CommandEnd extends ExecutionEnd {
  readonly durationMs: number;
}

/** A Task's run environment while The Office knows it is running. */
interface RunningEnvironment {
  readonly project: ComposeProject;
  readonly definition: RunEnvironmentDefinition;
  /** The worktree folder its containers have bind-mounted, as it was when it started. */
  readonly worktree: FolderIdentity | undefined;
  /**
   * The Stage runs' folder its override mounted as it started, which a condition command checks
   * before it runs (`readsStageRuns`): a running container never gains a mount.
   */
  readonly stageRunsFolder: string;
  idleStop: Wait | undefined;
}

/**
 * Which folder a path names: a folder removed and made again at the same path is another one, and
 * a running container keeps the old one mounted. That mount holds the old inode, so the new folder
 * can't be given its number.
 */
interface FolderIdentity {
  readonly device: number;
  readonly inode: number;
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
    private readonly hostCores: HostCores,
    private readonly serviceOwner: ServiceOwner,
    private readonly schedule: Schedule,
    private readonly busyWork: BusyWork,
    private readonly events: EventBus,
  ) {}

  async onModuleInit(): Promise<void> {
    this.events.subscribe(TaskStateChanged, ({ taskId, to }) => {
      if (!FINISHED_STATES.includes(to)) return;
      // In the background: the bus waits for its handlers, and the state change for nothing.
      void this.remove(taskId).catch((error: unknown) => {
        this.logger.error(`The run environment of the Task ${taskId} was not removed.`, error);
      });
    });
    // Before any Stage runs, so what is there was left by a service that stopped mid-command.
    await rm(this.folders.commandOutputs, { recursive: true, force: true });
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
  run(task: TaskInWorktree, command: RunEnvironmentCommand): Promise<CommandEnd> {
    return this.exclusively(task.taskId, () =>
      this.busyWork.during(this.busyItem(task), async () => {
        const environment = await this.started(
          task,
          command.startOutputFile ?? command.outputFile,
          command,
        );
        if (command.readsStageRuns && environment.stageRunsFolder !== task.stageRunsFolder) {
          throw new RunEnvironmentRefused([STAGE_RUNS_NOT_MOUNTED]);
        }
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
   * The image the Task's checks run in now, by its key, without building it: another one means
   * what was installed in the worktree inside the old one may not suit it.
   */
  async imageOf(task: TaskInWorktree): Promise<string> {
    return this.images.imageNameFor(task);
  }

  /**
   * Runs the check in the service, then, on a non-root Office, gives the files it wrote back to
   * The Office's user however it ended. A runtime failure, such as the service gone, or a hand-back
   * that fails stops the Task's run environment, freeing its slot, for the next check to start
   * again and hand back what was left.
   */
  private async execute(
    task: TaskInWorktree,
    environment: RunningEnvironment,
    command: RunEnvironmentCommand,
  ): Promise<CommandEnd> {
    const { owner } = this.serviceOwner;
    const startedAt = this.schedule.now().getTime();
    let end: ExecutionEnd;
    try {
      end = await this.runtime.exec(
        environment.project,
        {
          service: environment.definition.service,
          ...(environment.definition.user === undefined
            ? {}
            : { user: environment.definition.user }),
          script: commandScript(command.commandLine, task.worktree, command.environment, {
            trustRepositories: owner !== undefined,
          }),
          variables: commandVariables(command.environment),
          mask: command.mask,
          timeoutMs: command.timeoutMs,
          ...(command.signal === undefined ? {} : { signal: command.signal }),
        },
        command.outputFile,
      );
    } catch (error) {
      if (!(error instanceof ContainerRuntimeFailed)) throw error;
      throw await this.stoppedAsRefused(task.taskId, command.outputFile, [
        "The check couldn't run in the run environment.",
        error.message,
      ]);
    }
    const durationMs = this.schedule.now().getTime() - startedAt;
    if (owner !== undefined) {
      const problem = await this.handBack(task, environment, owner, command);
      if (problem !== undefined) {
        throw await this.stoppedAsRefused(task.taskId, command.outputFile, [
          "The files the check wrote couldn't be given back to The Office's user.",
          problem,
        ]);
      }
    }
    return { ...end, durationMs };
  }

  /**
   * Gives every file in the worktree another user owns back to The Office's (spec §5.5 Defaults,
   * "Run environments with a non-root Office"), as root, silent when it works. No signal: a
   * stopped check still hands back. Answers why it failed, or nothing.
   */
  private async handBack(
    task: TaskInWorktree,
    environment: RunningEnvironment,
    owner: FileOwnerIds,
    command: RunEnvironmentCommand,
  ): Promise<string | undefined> {
    try {
      const { exitCode, endedBy } = await this.runtime.exec(
        environment.project,
        {
          service: environment.definition.service,
          user: ROOT_USER,
          script: handBackScript(task.worktree, owner),
          variables: {},
          mask: command.mask,
          timeoutMs: HAND_BACK_TIMEOUT_MS,
        },
        command.outputFile,
      );
      if (endedBy === "timeout")
        return `It didn't end within ${HAND_BACK_TIMEOUT_MS / 60_000} minutes.`;
      if (exitCode !== 0) return `It ended with the exit code ${exitCode}.`;
      return undefined;
    } catch (error) {
      if (!(error instanceof ContainerRuntimeFailed)) throw error;
      return error.message;
    }
  }

  /**
   * Stops the Task's run environment, not just forgets it, so no service left running passes Run
   * environments at once, and answers the refusal to throw.
   */
  private async stoppedAsRefused(
    taskId: string,
    outputFile: string,
    reasons: readonly string[],
  ): Promise<RunEnvironmentRefused> {
    await this.stopNow(taskId).catch((stopError: unknown) => {
      this.logger.warn(`The run environment of the Task ${taskId} didn't stop.`, stopError);
    });
    return new RunEnvironmentRefused(reasons, outputFile);
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
    if (known !== undefined) {
      if (sameFolder(known.worktree, await folderIdentityOf(task.worktree))) return known;
      // Publish removes the worktree and the next Stage adds it again: exec into the old mount
      // fails in the runtime, so the containers start again on the new folder.
      await note(
        outputFile,
        "The Task's worktree was replaced; starting the run environment again.",
      );
      await this.failingAsRefused(outputFile, "The run environment couldn't stop.", () =>
        this.stopNow(task.taskId),
      );
    }
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

    await this.slotFor(task.taskId, options);
    // Taken before `up`: a folder replaced while it runs then reads as replaced at the next check,
    // never as the one the containers mounted.
    const worktree = await folderIdentityOf(task.worktree);
    try {
      await note(outputFile, `Starting the run environment ${project.name}.`);
      await this.failingAsRefused(outputFile, "The run environment couldn't start.", () =>
        this.runtime.up(project, outputFile),
      );
    } catch (error) {
      await this.slots.release(task.taskId);
      throw error;
    }
    const environment: RunningEnvironment = {
      project,
      definition,
      worktree,
      stageRunsFolder: task.stageRunsFolder,
      idleStop: undefined,
    };
    this.running.set(task.taskId, environment);
    this.stopWhenIdle(task.taskId, environment);
    if (created) {
      await this.events.publish(new RunEnvironmentCreated(task.taskId, task.projectId, image));
    }
    return environment;
  }

  /**
   * Takes the Task's slot, telling `onWaiting` when it has to wait and `onWaitOver` once the wait
   * ends, in that order, however it ends.
   */
  private async slotFor(taskId: string, options: SlotOptions): Promise<void> {
    let waitTold: Promise<void> | undefined;
    try {
      await this.slots.take(
        taskId,
        () => {
          waitTold = this.tell(taskId, options.onWaiting);
        },
        options.signal,
      );
    } finally {
      if (waitTold !== undefined) {
        await waitTold;
        await this.tell(taskId, options.onWaitOver);
      }
    }
  }

  private async tell(
    taskId: string,
    hook: (() => void | Promise<void>) | undefined,
  ): Promise<void> {
    try {
      await hook?.();
    } catch (error) {
      this.logger.warn(`The wait of the Task ${taskId} for a run environment wasn't told.`, error);
    }
  }

  /** Writes the Office's compose file over the repository's, for the Task. */
  private async writeProject(
    task: TaskInWorktree,
    definition: RunEnvironmentDefinition,
    image: string,
  ): Promise<ComposeProject> {
    const folder = this.folders.taskFolder(task.taskId);
    await mkdir(folder, { recursive: true });
    // A long-syntax bind mount fails to start when its source is missing, and Pipelines writes the
    // file only before a condition command.
    await mkdir(task.stageRunsFolder, { recursive: true });
    const { limits } = await this.settings.read();
    const override = join(folder, OVERRIDE_FILE);
    await writeFile(
      override,
      stringifyYaml(
        composeOverrideOf(
          definition,
          task,
          image,
          this.folders.instance,
          limits,
          this.hostCores.count,
        ),
      ),
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

/** The folder's identity, or none when it is gone, which no running environment's matches. */
async function folderIdentityOf(path: string): Promise<FolderIdentity | undefined> {
  return stat(path).then(
    ({ dev, ino }) => ({ device: dev, inode: ino }),
    () => undefined,
  );
}

function sameFolder(started: FolderIdentity | undefined, now: FolderIdentity | undefined): boolean {
  return (
    started !== undefined &&
    now !== undefined &&
    started.device === now.device &&
    started.inode === now.inode
  );
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
