import { Injectable, Logger } from "@nestjs/common";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  DEFINITION_FOLDER,
  type RunEnvironmentDefinition,
} from "../domain/run-environment-definition.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  LABEL,
  officeLabels,
  pairingLabels,
  pairingOverrideOf,
  pairingProjectNameOf,
} from "../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type AttachedProcess,
  type ComposeProject,
} from "../ports/container-runtime.js";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";
import { readDefinitionIn } from "./definition-files.js";
import { HostCores } from "./host-cores.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";
import { note, RunEnvironmentImages } from "./run-environment-images.js";
import {
  attachedIn,
  refusingOnRuntimeFailure,
  type RunEnvironmentAttachment,
} from "./runtime-steps.js";

/** What a pairing environment is started from (spec §5.5, "A pairing environment"). */
export interface PairingEnvironmentStart {
  readonly projectId: string;
  /** The Project device's id, which names the compose project. */
  readonly deviceId: string;
  /** A folder holding the base branch tip's `.devcontainer/`; the caller removes it afterwards. */
  readonly definitionFolder: string;
  /** The start's output, and each attached program's standard error, appended there. */
  readonly logFile: string;
  readonly signal?: AbortSignal;
}

/** One pairing environment, running until removed. */
export interface PairingEnvironment {
  /** Starts the program in the definition's service, as the checks' user unless `asRoot`. */
  attach(attachment: RunEnvironmentAttachment): Promise<AttachedProcess>;
  /** Removes its containers, volumes and orphans, then anything left by its labels; never throws. */
  remove(): Promise<void>;
}

/** The name of the compose file The Office puts over the definition's, in the pairing's folder. */
const OVERRIDE_FILE = "office-override.yaml";

/** A Project device's id, which names its folder and its compose project. */
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const STOPPED = "The pairing was stopped.";

/**
 * Pairing environments (spec §5.5, "A pairing environment"): each a compose project of its own,
 * `office-<office>-pairing-<device id>`, made from the base branch tip's `.devcontainer/` on the
 * definition's own image (no install command, no Install inputs: only the definition is there),
 * mounting no checkout and publishing no port, the device helper's folder read-only at
 * DEVICE_HELPER_MOUNT as in a Task's, for Devices' pairing over wireless debugging, and removed as
 * the pairing ends. It takes no Run environments at once slot and isn't Office-updates' busy work.
 */
@Injectable()
export class PairingEnvironments {
  private readonly logger = new Logger(PairingEnvironments.name);
  /** The Project devices with a pairing environment started and not yet removed. */
  private readonly started = new Set<string>();

  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly images: RunEnvironmentImages,
    private readonly folders: RunEnvironmentFolders,
    private readonly settings: RunEnvironmentSettings,
    private readonly hostCores: HostCores,
  ) {}

  /** Reads the definition, makes the image, and starts it; refused (RunEnvironmentRefused) in words, removing what it made. */
  async start(start: PairingEnvironmentStart): Promise<PairingEnvironment> {
    if (!DEVICE_ID.test(start.deviceId)) {
      throw new RunEnvironmentRefused([`${start.deviceId} isn't a Project device's id.`]);
    }
    if (this.started.has(start.deviceId)) {
      throw new RunEnvironmentRefused([
        `A pairing environment for the device ${start.deviceId} is already running.`,
      ]);
    }
    this.started.add(start.deviceId);
    try {
      const { project, definition } = await this.startedProject(start);
      return this.environmentOf(start, project, definition);
    } catch (error) {
      await this.removeNow(start.deviceId);
      if (error instanceof ContainerRuntimeFailed) {
        throw new RunEnvironmentRefused([error.message], start.logFile);
      }
      throw error;
    }
  }

  /** Removes every pairing environment of this Office left behind, by its labels (the startup sweep). */
  async sweep(): Promise<void> {
    const resources = await this.runtime.listByLabel(officeLabels(this.folders.instance));
    const ids = new Set(resources.map(({ labels }) => labels[LABEL.pairing] ?? ""));
    ids.delete("");
    for (const deviceId of ids) {
      if (DEVICE_ID.test(deviceId)) await this.removeNow(deviceId);
    }
    await rm(this.folders.pairings, { recursive: true, force: true });
  }

  private async startedProject(
    start: PairingEnvironmentStart,
  ): Promise<{ project: ComposeProject; definition: RunEnvironmentDefinition }> {
    const reading = await readDefinitionIn(start.definitionFolder);
    if (reading.value === undefined) {
      throw new RunEnvironmentRefused(
        ["The run environment definition on the base branch isn't valid.", ...reading.problems],
        start.logFile,
      );
    }
    const definition = reading.value;
    refuseWhenStopped(start);

    await note(start.logFile, "Building the pairing environment's image.");
    const image = await refusingOnRuntimeFailure(
      start.logFile,
      "The pairing environment's image couldn't be built.",
      () =>
        // The definition's own image: only `.devcontainer/` is there, so no install runs.
        this.images.imageFor(
          {
            projectId: start.projectId,
            worktree: start.definitionFolder,
            installCommand: undefined,
            installInputs: [],
            installVariables: [],
          },
          definition,
          start.logFile,
        ),
    );
    refuseWhenStopped(start);

    const project = await this.writeProject(start, definition, image);
    await note(start.logFile, `Starting the pairing environment ${project.name}.`);
    await refusingOnRuntimeFailure(start.logFile, "The pairing environment couldn't start.", () =>
      this.runtime.up(project, start.logFile),
    );
    refuseWhenStopped(start);
    return { project, definition };
  }

  /** Writes the Office's compose file over the definition's, for the Project device. */
  private async writeProject(
    start: PairingEnvironmentStart,
    definition: RunEnvironmentDefinition,
    image: string,
  ): Promise<ComposeProject> {
    const folder = this.folders.pairingFolder(start.deviceId);
    await mkdir(folder, { recursive: true });
    // A long-syntax bind mount fails to start when its source is missing.
    await mkdir(this.folders.deviceHelper, { recursive: true });
    const { limits } = await this.settings.read();
    const override = join(folder, OVERRIDE_FILE);
    await writeFile(
      override,
      stringifyYaml(
        pairingOverrideOf(
          definition,
          {
            deviceId: start.deviceId,
            projectId: start.projectId,
            deviceHelperFolder: this.folders.deviceHelper,
          },
          image,
          this.folders.instance,
          limits,
          this.hostCores.count,
        ),
      ),
    );
    return {
      name: pairingProjectNameOf(this.folders.instance, start.deviceId),
      files: [
        ...definition.composeFiles.map((file) => join(start.definitionFolder, file)),
        override,
      ],
      projectDirectory: join(start.definitionFolder, DEFINITION_FOLDER),
      services: definition.runServices,
    };
  }

  private environmentOf(
    start: PairingEnvironmentStart,
    project: ComposeProject,
    definition: RunEnvironmentDefinition,
  ): PairingEnvironment {
    let removal: Promise<void> | undefined;
    return {
      attach: (attachment) => {
        if (removal !== undefined) {
          return Promise.reject(
            new RunEnvironmentRefused(["The pairing environment was removed."]),
          );
        }
        return attachedIn(this.runtime, project, definition, attachment, start.logFile);
      },
      remove: () => {
        removal ??= this.removeNow(start.deviceId);
        return removal;
      },
    };
  }

  /**
   * Takes the compose project down with its volumes, orphans and built images, then removes whatever still
   * carries its label, and its files; never throws, a failure only logged.
   */
  private async removeNow(deviceId: string): Promise<void> {
    const projectName = pairingProjectNameOf(this.folders.instance, deviceId);
    try {
      // With the images compose built for its other services, as a Test instance's.
      await this.runtime.down(projectName, { builtImages: true });
    } catch (error) {
      // What down left is removed by its label next.
      this.logger.warn(
        `The pairing environment of the device ${deviceId} didn't come down.`,
        error,
      );
    }
    try {
      await this.runtime.removeByLabel(pairingLabels(this.folders.instance, deviceId));
      await rm(this.folders.pairingFolder(deviceId), { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `The pairing environment of the device ${deviceId} wasn't wholly removed.`,
        error,
      );
    } finally {
      this.started.delete(deviceId);
    }
  }
}

function refuseWhenStopped(start: PairingEnvironmentStart): void {
  if (start.signal?.aborted === true) throw new RunEnvironmentRefused([STOPPED], start.logFile);
}
