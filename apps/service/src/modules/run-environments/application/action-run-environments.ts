import { Injectable, Logger } from "@nestjs/common";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  DEFINITION_FOLDER,
  type RunEnvironmentDefinition,
} from "../domain/run-environment-definition.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  actionRunLabels,
  actionRunOverrideOf,
  actionRunProjectNameOf,
  commandBeforeScript,
  commandVariables,
  LABEL,
  officeLabels,
  type CommandEnvironment,
  type InstallVariable,
} from "../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type ComposeProject,
  type StreamedOutputMask,
} from "../ports/container-runtime.js";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";
import { CheckoutHandOver } from "./checkout-hand-over.js";
import { readDefinitionIn } from "./definition-files.js";
import { HostCores } from "./host-cores.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";
import { note, RunEnvironmentImages } from "./run-environment-images.js";
import { refusingOnRuntimeFailure } from "./runtime-steps.js";
import { ServiceOwner } from "./service-owner.js";

/** What an Action's Project command run is run from (spec §2.15, "Where a run runs"). */
export interface ActionRunStart {
  /** The Action run's id, a uuid. */
  readonly runId: string;
  readonly projectId: string;
  /** The run's checkout, an absolute path: the one host folder mounted, at its own path. */
  readonly checkout: string;
  /** The commands before it, then the command itself last, run one after another by `exec`. */
  readonly commands: readonly { readonly name: string; readonly commandLine: string }[];
  /**
   * The Project's environment and Secret variables with what The Office sets over them, as a
   * Task's check gets them: each value by its carrier, never in a command line.
   */
  readonly environment: CommandEnvironment;
  /** The Project's install command, Install inputs and variables, for its image. */
  readonly installCommand: string | undefined;
  readonly installInputs: readonly string[];
  readonly installVariables: readonly InstallVariable[];
  /** Mounts the Office device helper's folder, as for an Action that names a device. */
  readonly withDeviceHelper?: boolean;
  /** An absolute path: everything the run prints is appended there, masked. */
  readonly logFile: string;
  readonly mask: StreamedOutputMask;
  /** How long the commands may take together, the image's build and the start left out. */
  readonly timeoutMs: number;
  /** Ends the run: what it started is removed, and it answers as stopped. */
  readonly signal?: AbortSignal;
}

/** How the commands ended: on the first that didn't end with 0, else on the last. */
export interface ActionRunEnd {
  /** The command it ended on, by its name. */
  readonly name: string;
  /** Only when it ended by itself. */
  readonly exitCode: number | undefined;
  /** It ran past the run's time, or the run was stopped. */
  readonly endedBy?: "timeout" | "stop";
}

/** An Action run's id, which names its folder and its compose project. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** The name of the compose file The Office puts over the checkout's. */
const OVERRIDE_FILE = "office-override.yaml";

/** The file, beside the override, that says how to give the checkout back as the run ends. */
const HAND_BACK_FILE = "checkout-hand-back.json";

const STOPPED = "The Action run was stopped.";

/**
 * Action runs' Project command runs with the Project's Run environment On (spec §5.5, "An Action
 * run's checkout"): each its own compose project, `office-<office>-action-<run id>`, from the
 * checkout's own `.devcontainer/` on the Project's image, the checkout alone mounted, nothing
 * published, the Office-wide limits on every service, labelled `office.action-run`; its commands
 * run by `exec` in the definition's service; removed with its volumes however the run ends. It
 * takes no Run environments at once slot and isn't Office-updates' busy work: Actions at once
 * limits it.
 */
@Injectable()
export class ActionRunEnvironments {
  private readonly logger = new Logger(ActionRunEnvironments.name);
  /** Each run started and not ended: aborted as it stops. */
  private readonly running = new Map<string, AbortController>();
  /** Each run's last removal, which the next one waits for. */
  private readonly removals = new Map<string, Promise<void>>();
  private readonly handOver: CheckoutHandOver;

  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly images: RunEnvironmentImages,
    private readonly folders: RunEnvironmentFolders,
    private readonly settings: RunEnvironmentSettings,
    private readonly hostCores: HostCores,
    serviceOwner: ServiceOwner,
  ) {
    this.handOver = new CheckoutHandOver(runtime, serviceOwner, this.logger);
  }

  /**
   * Builds the Project's image, brings the run's compose project up, gives the checkout to the
   * checks' user, then runs the commands one after another, each named in the log first; then
   * removes the compose project with its volumes, however the run ended. Refuses with why, in the
   * user's words (an invalid `.devcontainer/` with its problems), when it couldn't run.
   */
  async run(start: ActionRunStart): Promise<ActionRunEnd> {
    if (!RUN_ID.test(start.runId)) {
      throw new RunEnvironmentRefused([`${start.runId} isn't an Action run's id.`]);
    }
    if (this.running.has(start.runId)) {
      throw new RunEnvironmentRefused([`The Action run ${start.runId} is already running.`]);
    }
    if (start.commands.length === 0) {
      throw new RunEnvironmentRefused(["The Action run has no command to run."]);
    }
    const stopping = new AbortController();
    this.running.set(start.runId, stopping);
    const stopped = (): void => stopping.abort();
    start.signal?.addEventListener("abort", stopped, { once: true });
    try {
      if (start.signal?.aborted) stopping.abort();
      return await this.ran(start, stopping.signal);
    } catch (error) {
      if (error instanceof ContainerRuntimeFailed) {
        throw new RunEnvironmentRefused([error.message], start.logFile);
      }
      throw error;
    } finally {
      start.signal?.removeEventListener("abort", stopped);
      await this.stop(start.runId).catch((stopError: unknown) => {
        this.logger.warn(`The Action run ${start.runId} wasn't cleaned up.`, stopError);
      });
    }
  }

  /**
   * Ends the run's commands and takes its compose project down with its volumes, orphans and the
   * images compose built for it, then removes whatever still carries its label, and its files.
   * Stopping one not running, or stopped already, does the same and finds nothing.
   */
  stop(runId: string): Promise<void> {
    if (!RUN_ID.test(runId)) return Promise.resolve();
    const running = this.running.get(runId);
    this.running.delete(runId);
    running?.abort();
    const previous = this.removals.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.removeNow(runId));
    const settled = next.catch(() => undefined);
    this.removals.set(runId, settled);
    void settled.finally(() => {
      if (this.removals.get(runId) === settled) this.removals.delete(runId);
    });
    return next;
  }

  /**
   * As The Office starts: removes every Action run's compose project of this Office the runtime
   * still holds and their files, whatever their id, but those of runs started since.
   */
  async sweep(): Promise<void> {
    const resources = await this.runtime.listByLabel(officeLabels(this.folders.instance));
    const folders = await readdir(this.folders.actionRuns).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const ids = new Set([
      ...resources.map(({ labels }) => labels[LABEL.actionRun] ?? ""),
      ...folders,
    ]);
    ids.delete("");
    for (const runId of ids) {
      if (!this.running.has(runId)) await this.stop(runId);
    }
  }

  private async ran(start: ActionRunStart, stopping: AbortSignal): Promise<ActionRunEnd> {
    const definition = await this.definitionIn(start.checkout, start.logFile);
    refuseWhenStopped(stopping, start.logFile);

    await note(start.logFile, "Building the run environment's image.");
    const image = await refusingOnRuntimeFailure(
      start.logFile,
      "The run environment's image couldn't be built.",
      () =>
        this.images.imageFor(
          { ...start, worktree: start.checkout },
          definition,
          start.logFile,
          start.mask,
        ),
    );
    refuseWhenStopped(stopping, start.logFile);

    const { limits } = await this.settings.read();
    const override = actionRunOverrideOf(
      definition,
      {
        runId: start.runId,
        projectId: start.projectId,
        checkout: start.checkout,
        deviceHelperFolder: start.withDeviceHelper === true ? this.folders.deviceHelper : undefined,
      },
      image,
      this.folders.instance,
      limits,
      this.hostCores.count,
    );
    const project = projectOf(
      start,
      this.folders.instance,
      definition,
      await this.overrideFileOf(start.runId, override),
    );
    if (start.withDeviceHelper === true)
      await mkdir(this.folders.deviceHelper, { recursive: true });

    await note(start.logFile, `Starting ${project.name}.`);
    await refusingOnRuntimeFailure(start.logFile, "The run environment couldn't start.", () =>
      this.runtime.up(project, start.logFile, start.mask),
    );
    refuseWhenStopped(stopping, start.logFile);
    await this.handOver.toChecksUser(
      {
        checkout: start.checkout,
        logFile: start.logFile,
        mask: start.mask,
        handBackFile: this.handBackFileOf(start.runId),
        stoppedWords: STOPPED,
      },
      project,
      definition,
      stopping,
    );

    // The commands share the run's time.
    const deadline = Date.now() + start.timeoutMs;
    let ended: ActionRunEnd | undefined;
    for (const { name, commandLine } of start.commands) {
      await note(start.logFile, `Running ${name}.`);
      const { exitCode, endedBy } = await this.runtime.exec(
        project,
        {
          service: definition.service,
          ...(definition.user === undefined ? {} : { user: definition.user }),
          script: commandBeforeScript(start.checkout, commandLine, start.environment),
          variables: commandVariables(start.environment),
          mask: start.mask,
          timeoutMs: Math.max(1, deadline - Date.now()),
          signal: stopping,
        },
        start.logFile,
      );
      const stoppedNow = stopping.aborted ? "stop" : endedBy;
      ended =
        stoppedNow === undefined ? { name, exitCode } : { name, exitCode, endedBy: stoppedNow };
      if (stoppedNow !== undefined || exitCode !== 0) return ended;
    }
    return ended as ActionRunEnd;
  }

  private async definitionIn(checkout: string, logFile: string): Promise<RunEnvironmentDefinition> {
    const reading = await readDefinitionIn(checkout);
    if (reading.value === undefined) {
      throw new RunEnvironmentRefused(
        ["The run environment definition on this branch isn't valid.", ...reading.problems],
        logFile,
      );
    }
    return reading.value;
  }

  /** Writes the run's override into its own folder; answers the file. */
  private async overrideFileOf(runId: string, override: Record<string, unknown>): Promise<string> {
    const folder = this.folders.actionRunFolder(runId);
    await mkdir(folder, { recursive: true });
    const overrideFile = join(folder, OVERRIDE_FILE);
    await writeFile(overrideFile, stringifyYaml(override));
    return overrideFile;
  }

  private handBackFileOf(runId: string): string {
    return join(this.folders.actionRunFolder(runId), HAND_BACK_FILE);
  }

  private async removeNow(runId: string): Promise<void> {
    const projectName = actionRunProjectNameOf(this.folders.instance, runId);
    await this.handOver.back(this.handBackFileOf(runId), `the Action run ${runId}`);
    try {
      await this.runtime.down(projectName, { builtImages: true });
    } catch (error) {
      // What down left is removed by its label next.
      this.logger.warn(`The Action run ${runId} didn't come down.`, error);
    }
    await this.runtime.removeByLabel(actionRunLabels(this.folders.instance, runId));
    await rm(this.folders.actionRunFolder(runId), { recursive: true, force: true });
  }
}

function refuseWhenStopped(stopping: AbortSignal, logFile: string): void {
  if (stopping.aborted) throw new RunEnvironmentRefused([STOPPED], logFile);
}

/**
 * The compose project of the run: the checkout's compose files with The Office's over them, the
 * definition's services; no variable in the CLI's environment, as each command takes its own.
 */
function projectOf(
  start: Pick<ActionRunStart, "runId" | "checkout">,
  instance: string,
  definition: RunEnvironmentDefinition,
  overrideFile: string,
): ComposeProject {
  return {
    name: actionRunProjectNameOf(instance, start.runId),
    files: [...definition.composeFiles.map((file) => join(start.checkout, file)), overrideFile],
    projectDirectory: join(start.checkout, DEFINITION_FOLDER),
    services: [...definition.runServices],
    variables: {},
  };
}
