import { Injectable, Logger } from "@nestjs/common";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { stringify as stringifyYaml } from "yaml";
import {
  DEFINITION_FOLDER,
  type RunEnvironmentDefinition,
} from "../domain/run-environment-definition.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  BUILD_CACHE_FOLDERS,
  BUILD_CACHE_OWNERSHIP_SCRIPT,
  buildCacheLabels,
  buildCacheVolumeOf,
  buildOverrideOf,
  carrierOf,
  entryPointCommandOf,
  entryPointScript,
  hostedOverrideOf,
  hostedProjectNameOf,
  LABEL,
  officeLabels,
  testInstanceLabels,
  type CommandEntryPoint,
  type EntryPointCommand,
  type HostedEntryPoint,
  type InstallVariable,
} from "../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type ComposeProject,
  type StreamedOutputMask,
} from "../ports/container-runtime.js";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";
import { readDefinitionIn } from "./definition-files.js";
import { HostCores } from "./host-cores.js";
import { HostedServiceReadiness } from "./hosted-service-readiness.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";
import { note, RunEnvironmentImages } from "./run-environment-images.js";

/** What a Hosted Test instance is started from (spec §2.12, "Hosted runs in the run environment"). */
export interface HostedServiceStart {
  /** The Test instance's id, a uuid. */
  readonly instanceId: string;
  readonly projectId: string;
  /** The instance's checkout, an absolute path: the one host folder mounted, at its own path. */
  readonly checkout: string;
  /** The test target's entry point. */
  readonly entryPoint: HostedEntryPoint;
  /** The port the app listens on inside its service. */
  readonly containerPort: number;
  /** The target's own plain and Secret variables, never the Project's Secret variables. */
  readonly variables: readonly { readonly name: string; readonly value: string }[];
  /** The Project's install command, Install inputs and variables, for its image. */
  readonly installCommand: string | undefined;
  readonly installInputs: readonly string[];
  readonly installVariables: readonly InstallVariable[];
  /** An absolute path: everything the instance prints is appended there, masked. */
  readonly logFile: string;
  readonly mask: StreamedOutputMask;
  /** Ends a start still Building: what it started is cleaned up and it refuses. */
  readonly signal?: AbortSignal;
}

/**
 * What a Build to install Test instance is built from (spec §2.12, "Build to install"): as a Hosted
 * one's start, with an entry point The Office runs as a command and no port.
 */
export interface TestBuildStart extends Omit<HostedServiceStart, "entryPoint" | "containerPort"> {
  readonly entryPoint: CommandEntryPoint;
  /** How long the build may take before it is ended. */
  readonly timeoutMs: number;
}

/** How a build ended: its exit code only when it ended by itself. */
export interface TestBuildEnd {
  readonly exitCode: number | undefined;
  readonly endedBy?: "timeout" | "stop";
}

/** A Hosted Test instance's app, started and answering. */
export interface HostedService {
  /** The port on 127.0.0.1 the runtime published for the app's container port. */
  readonly hostPort: number;
}

/** The longest a timer runs: an entry point runs until the instance stops. */
const ENTRY_POINT_TIMEOUT_MS = 2 ** 31 - 1;

/** How long giving the build cache's folders to the build's user may take. */
const BUILD_CACHE_OWNERSHIP_TIMEOUT_MS = 60_000;

/** The name of the compose file The Office puts over the checkout's. */
const OVERRIDE_FILE = "office-override.yaml";

/** A Test instance's id, which names its folder and its compose project. */
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Hosted Test instances, each its own compose project (spec §5.5, "A test instance's checkout"):
 * made from the checkout's own definition on the Project's image, the target's port alone
 * published on 127.0.0.1, removed with its volumes when it stops; and Build to install ones, built
 * in a compose project of their own removed once the build ends. The Test instances module's one
 * way into the runtime. It takes no Run environments at once slot and isn't Office-updates' busy
 * work: Test instances at once limits it.
 */
@Injectable()
export class HostedServices {
  private readonly logger = new Logger(HostedServices.name);
  /** Each instance started and not stopped: aborted as it stops, which ends its log following. */
  private readonly running = new Map<string, AbortController>();
  /** Each instance's last stop, which the next one waits for. */
  private readonly stops = new Map<string, Promise<void>>();

  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly images: RunEnvironmentImages,
    private readonly folders: RunEnvironmentFolders,
    private readonly settings: RunEnvironmentSettings,
    private readonly hostCores: HostCores,
    private readonly readiness: HostedServiceReadiness,
  ) {}

  /**
   * Builds the image, brings the instance's compose project up, starts the entry point and waits
   * for the app to answer on its port. Refuses with why, in the user's words, after removing what
   * it started. `onEnded` is told once should the app end on its own after that.
   */
  async start(
    start: HostedServiceStart,
    onEnded: (reason: string) => void,
  ): Promise<HostedService> {
    if (!INSTANCE_ID.test(start.instanceId)) {
      throw new RunEnvironmentRefused([`${start.instanceId} isn't a Test instance's id.`]);
    }
    if (this.running.has(start.instanceId)) {
      throw new RunEnvironmentRefused([
        `The Test instance ${start.instanceId} is already running.`,
      ]);
    }
    const stopping = new AbortController();
    this.running.set(start.instanceId, stopping);
    const stopped = (): void => stopping.abort();
    start.signal?.addEventListener("abort", stopped, { once: true });
    try {
      if (start.signal?.aborted) stopping.abort();
      return await this.started(start, stopping.signal, onEnded);
    } catch (error) {
      await this.stop(start.instanceId).catch((stopError: unknown) => {
        this.logger.warn(`The Test instance ${start.instanceId} wasn't cleaned up.`, stopError);
      });
      if (error instanceof ContainerRuntimeFailed) {
        throw new RunEnvironmentRefused([error.message], start.logFile);
      }
      throw error;
    } finally {
      start.signal?.removeEventListener("abort", stopped);
    }
  }

  /**
   * Builds a Build to install Test instance: the image, its own compose project over the checkout
   * with the Project's build cache volume, the entry point run to its end in the devcontainer's
   * service, its output appended to the log, masked; then the compose project is removed, however
   * the build ended. Refuses with why, in the user's words, when it couldn't run.
   */
  async build(start: TestBuildStart): Promise<TestBuildEnd> {
    if (!INSTANCE_ID.test(start.instanceId)) {
      throw new RunEnvironmentRefused([`${start.instanceId} isn't a Test instance's id.`]);
    }
    if (this.running.has(start.instanceId)) {
      throw new RunEnvironmentRefused([
        `The Test instance ${start.instanceId} is already running.`,
      ]);
    }
    const stopping = new AbortController();
    this.running.set(start.instanceId, stopping);
    const stopped = (): void => stopping.abort();
    start.signal?.addEventListener("abort", stopped, { once: true });
    try {
      if (start.signal?.aborted) stopping.abort();
      return await this.built(start, stopping.signal);
    } catch (error) {
      if (error instanceof ContainerRuntimeFailed) {
        throw new RunEnvironmentRefused([error.message], start.logFile);
      }
      throw error;
    } finally {
      start.signal?.removeEventListener("abort", stopped);
      await this.stop(start.instanceId).catch((stopError: unknown) => {
        this.logger.warn(`The Test instance ${start.instanceId} wasn't cleaned up.`, stopError);
      });
    }
  }

  /**
   * Takes the instance's compose project down with its volumes, orphans and the images compose
   * built for it, then removes whatever still carries its label, and its files. Stopping one not
   * running, or stopped already, does the same and finds nothing.
   */
  stop(instanceId: string): Promise<void> {
    if (!INSTANCE_ID.test(instanceId)) return Promise.resolve();
    const running = this.running.get(instanceId);
    this.running.delete(instanceId);
    running?.abort();
    const previous = this.stops.get(instanceId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.removeNow(instanceId));
    const settled = next.catch(() => undefined);
    this.stops.set(instanceId, settled);
    void settled.finally(() => {
      if (this.stops.get(instanceId) === settled) this.stops.delete(instanceId);
    });
    return next;
  }

  /**
   * As The Office starts: removes every Hosted Test instance of this Office the runtime still holds
   * and their files, whatever their id, since none is running yet.
   */
  async sweep(): Promise<void> {
    const resources = await this.runtime.listByLabel(officeLabels(this.folders.instance));
    const ids = new Set(resources.map(({ labels }) => labels[LABEL.testInstance] ?? ""));
    ids.delete("");
    for (const instanceId of ids) await this.stop(instanceId);
    await rm(this.folders.testInstances, { recursive: true, force: true });
  }

  private async started(
    start: HostedServiceStart,
    stopping: AbortSignal,
    onEnded: (reason: string) => void,
  ): Promise<HostedService> {
    const definition = await this.definitionIn(start.checkout, start.logFile);
    const appService =
      start.entryPoint.kind === "devcontainer-service"
        ? start.entryPoint.service
        : definition.service;
    const command = commandOf(start);
    refuseWhenStopped(stopping, start.logFile);

    const image = await this.imageOf(start, definition);
    refuseWhenStopped(stopping, start.logFile);

    const { limits } = await this.settings.read();
    const override = hostedOverrideOf(
      definition,
      {
        testInstanceId: start.instanceId,
        projectId: start.projectId,
        checkout: start.checkout,
        appService,
        containerPort: start.containerPort,
        variableNames: start.variables.map(({ name }) => name),
      },
      image,
      this.folders.instance,
      limits,
      this.hostCores.count,
    );
    if (override.value === undefined) {
      throw new RunEnvironmentRefused(override.problems, start.logFile);
    }
    const project = projectOf(
      start,
      this.folders.instance,
      definition,
      appService,
      await this.overrideFileOf(start.instanceId, override.value),
    );

    await note(start.logFile, `Starting ${project.name}.`);
    await this.refusing(start.logFile, "The run environment couldn't start.", () =>
      this.runtime.up(project, start.logFile, start.mask),
    );
    refuseWhenStopped(stopping, start.logFile);

    const ended = this.run(start, project, definition, command, appService, stopping);
    const hostPort = await this.refusing(
      start.logFile,
      `The app's port ${start.containerPort} isn't published.`,
      () => this.runtime.publishedPort(project, appService, start.containerPort),
    );
    const problem = await this.answering(hostPort, start.containerPort, ended, stopping);
    if (problem !== undefined) throw new RunEnvironmentRefused([problem], start.logFile);

    void ended.then((reason) => {
      if (!stopping.aborted && reason !== undefined) onEnded(reason);
      return undefined;
    });
    await note(start.logFile, `The app answers on port ${start.containerPort}.`);
    return { hostPort };
  }

  private async built(start: TestBuildStart, stopping: AbortSignal): Promise<TestBuildEnd> {
    const definition = await this.definitionIn(start.checkout, start.logFile);
    const command = entryPointCommandOf(start.entryPoint, start.checkout);
    if ("problem" in command) throw new RunEnvironmentRefused([command.problem], start.logFile);
    refuseWhenStopped(stopping, start.logFile);

    const image = await this.imageOf(start, definition);
    refuseWhenStopped(stopping, start.logFile);

    const { limits } = await this.settings.read();
    const override = buildOverrideOf(
      definition,
      {
        testInstanceId: start.instanceId,
        projectId: start.projectId,
        checkout: start.checkout,
        variableNames: start.variables.map(({ name }) => name),
      },
      image,
      this.folders.instance,
      limits,
      this.hostCores.count,
    );
    if (override.value === undefined) {
      throw new RunEnvironmentRefused(override.problems, start.logFile);
    }
    const project = projectOf(
      start,
      this.folders.instance,
      definition,
      definition.service,
      await this.overrideFileOf(start.instanceId, override.value),
    );
    await this.refusing(start.logFile, "The build cache volume couldn't be made.", () =>
      this.runtime.createVolume(
        buildCacheVolumeOf(this.folders.instance, start.projectId),
        buildCacheLabels(this.folders.instance, start.projectId),
      ),
    );

    await note(start.logFile, `Starting ${project.name}.`);
    await this.refusing(start.logFile, "The run environment couldn't start.", () =>
      this.runtime.up(project, start.logFile, start.mask),
    );
    refuseWhenStopped(stopping, start.logFile);
    if (definition.user !== undefined) {
      await this.giveBuildCacheTo(definition.user, project, definition.service, start, stopping);
      refuseWhenStopped(stopping, start.logFile);
    }

    await note(start.logFile, `Running ${command.command.argv.join(" ")}.`);
    return this.runtime.exec(
      project,
      {
        service: definition.service,
        ...(definition.user === undefined ? {} : { user: definition.user }),
        script: entryPointScript(command.command.folder),
        arguments: command.command.argv,
        variables: {},
        mask: start.mask,
        timeoutMs: start.timeoutMs,
        signal: stopping,
      },
      start.logFile,
    );
  }

  /** Makes the build cache's folders the build's user's, refusing the build when that fails. */
  private async giveBuildCacheTo(
    user: string,
    project: ComposeProject,
    service: string,
    start: TestBuildStart,
    stopping: AbortSignal,
  ): Promise<void> {
    const { exitCode } = await this.runtime.exec(
      project,
      {
        service,
        user: "root",
        script: BUILD_CACHE_OWNERSHIP_SCRIPT,
        arguments: [user, ...BUILD_CACHE_FOLDERS],
        variables: {},
        mask: start.mask,
        timeoutMs: BUILD_CACHE_OWNERSHIP_TIMEOUT_MS,
        signal: stopping,
      },
      start.logFile,
    );
    if (exitCode !== 0 && !stopping.aborted) {
      throw new RunEnvironmentRefused(
        [`The build cache volume couldn't be given to the user ${user}.`],
        start.logFile,
      );
    }
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

  private async imageOf(
    start: Pick<
      HostedServiceStart,
      | "projectId"
      | "checkout"
      | "installCommand"
      | "installInputs"
      | "installVariables"
      | "logFile"
      | "mask"
    >,
    definition: RunEnvironmentDefinition,
  ): Promise<string> {
    await note(start.logFile, "Building the run environment's image.");
    return this.refusing(start.logFile, "The run environment's image couldn't be built.", () =>
      this.images.imageFor(
        { ...start, worktree: start.checkout },
        definition,
        start.logFile,
        start.mask,
      ),
    );
  }

  /** Writes the instance's override into its own folder; answers the file. */
  private async overrideFileOf(
    instanceId: string,
    override: Record<string, unknown>,
  ): Promise<string> {
    const folder = this.folders.testInstanceFolder(instanceId);
    await mkdir(folder, { recursive: true });
    const overrideFile = join(folder, OVERRIDE_FILE);
    await writeFile(overrideFile, stringifyYaml(override));
    return overrideFile;
  }

  /**
   * Follows the services' logs into the log file and runs the entry point in the devcontainer's
   * service; answers why the app ended once it does, or nothing when it was stopped.
   */
  private run(
    start: HostedServiceStart,
    project: ComposeProject,
    definition: RunEnvironmentDefinition,
    command: EntryPointCommand | undefined,
    appService: string,
    stopping: AbortSignal,
  ): Promise<string | undefined> {
    if (command === undefined) {
      // The service is the app: its logs end when it does.
      return this.runtime
        .followLogs(project, appService, start.logFile, start.mask, stopping)
        .then(() => (stopping.aborted ? undefined : `The service ${appService} ended.`));
    }
    void this.runtime.followLogs(project, undefined, start.logFile, start.mask, stopping);
    return this.runtime
      .exec(
        project,
        {
          service: definition.service,
          ...(definition.user === undefined ? {} : { user: definition.user }),
          script: entryPointScript(command.folder),
          arguments: command.argv,
          variables: {},
          mask: start.mask,
          timeoutMs: ENTRY_POINT_TIMEOUT_MS,
        },
        start.logFile,
      )
      .then(
        ({ exitCode }) =>
          stopping.aborted
            ? undefined
            : exitCode === undefined
              ? "The entry point ended."
              : `The entry point ended with the exit code ${exitCode}.`,
        (error: unknown) =>
          stopping.aborted
            ? undefined
            : `The entry point couldn't run. ${error instanceof Error ? error.message : String(error)}`,
      );
  }

  /** Waits for the app to answer on its port; answers why it didn't, or nothing once it does. */
  private async answering(
    hostPort: number,
    containerPort: number,
    ended: Promise<string | undefined>,
    stopping: AbortSignal,
  ): Promise<string | undefined> {
    let endedWith: string | undefined;
    let hasEnded = false;
    void ended.then((reason) => {
      hasEnded = true;
      endedWith = reason;
      return undefined;
    });
    const deadline = Date.now() + this.readiness.timeoutMs;
    for (;;) {
      if (stopping.aborted) return STOPPED;
      if (hasEnded) return endedWith ?? STOPPED;
      if (await this.readiness.answers(hostPort)) return undefined;
      if (Date.now() >= deadline) return `The app didn't answer on port ${containerPort}.`;
      await sleep(this.readiness.intervalMs);
    }
  }

  private async removeNow(instanceId: string): Promise<void> {
    const projectName = hostedProjectNameOf(this.folders.instance, instanceId);
    try {
      await this.runtime.down(projectName, { builtImages: true });
    } catch (error) {
      // What down left is removed by its label next.
      this.logger.warn(`The Test instance ${instanceId} didn't come down.`, error);
    }
    await this.runtime.removeByLabel(testInstanceLabels(this.folders.instance, instanceId));
    await rm(this.folders.testInstanceFolder(instanceId), { recursive: true, force: true });
  }

  private async refusing<Result>(
    logFile: string,
    reason: string,
    step: () => Promise<Result>,
  ): Promise<Result> {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof ContainerRuntimeFailed)) throw error;
      throw new RunEnvironmentRefused([reason, error.message], logFile);
    }
  }
}

const STOPPED = "The Test instance was stopped.";

function refuseWhenStopped(stopping: AbortSignal, logFile: string): void {
  if (stopping.aborted) throw new RunEnvironmentRefused([STOPPED], logFile);
}

/** The entry point's command, none for a devcontainer service; refused when it leads outside. */
function commandOf(start: HostedServiceStart): EntryPointCommand | undefined {
  if (start.entryPoint.kind === "devcontainer-service") return undefined;
  const command = entryPointCommandOf(start.entryPoint, start.checkout);
  if ("problem" in command) throw new RunEnvironmentRefused([command.problem], start.logFile);
  return command.command;
}

/**
 * The compose project of the instance: the checkout's compose files with The Office's over them,
 * the definition's services and the app's, the variables in the CLI's environment by carrier.
 */
function projectOf(
  start: Pick<HostedServiceStart, "instanceId" | "checkout" | "variables">,
  instance: string,
  definition: RunEnvironmentDefinition,
  appService: string,
  overrideFile: string,
): ComposeProject {
  return {
    name: hostedProjectNameOf(instance, start.instanceId),
    files: [...definition.composeFiles.map((file) => join(start.checkout, file)), overrideFile],
    projectDirectory: join(start.checkout, DEFINITION_FOLDER),
    services: [...new Set([...definition.runServices, appService])],
    variables: Object.fromEntries(
      start.variables.map(({ value }, index) => [carrierOf(index), value]),
    ),
  };
}
