import { Injectable, Logger } from "@nestjs/common";
import { appendFile, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { RunEnvironmentDefinition } from "../domain/run-environment-definition.js";
import { RunEnvironmentImageBuilt } from "../domain/run-environment-events.js";
import {
  baseImageNameOf,
  imageKeyOf,
  imageNameOf,
  installDockerfile,
  installSecrets,
  INSTALL_INPUTS_FOLDER,
} from "../domain/run-environment-image.js";
import { officeLabels, type ImageSource } from "../domain/run-environment.js";
import { ContainerRuntime, type StreamedOutputMask } from "../ports/container-runtime.js";
import { imageInputsOf } from "./definition-files.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";

/**
 * The image cache (spec §5.5): a Project's image is built from the definition with the install
 * command run in it, once per key; an image already there for the key is used as it is.
 */
@Injectable()
export class RunEnvironmentImages {
  private readonly logger = new Logger(RunEnvironmentImages.name);
  /** The builds going on, by image, so two Tasks needing one image wait for one build. */
  private readonly building = new Map<string, Promise<void>>();

  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly folders: RunEnvironmentFolders,
    private readonly events: EventBus,
  ) {}

  /** The name of the Task's image by the key of what it is made from now, built or not. */
  async imageNameFor(task: ImageSource): Promise<string> {
    return imageNameOf(task.projectId, imageKeyOf(await imageInputsOf(task)));
  }

  /** The Task's image, built first unless one is there for its key. */
  async imageFor(
    task: ImageSource,
    definition: RunEnvironmentDefinition,
    outputFile: string,
    /** Masks the build's output on its way to the file; none for a Task's, as before. */
    mask?: StreamedOutputMask,
  ): Promise<string> {
    const inputs = await imageInputsOf(task);
    const key = imageKeyOf(inputs);
    const image = imageNameOf(task.projectId, key);
    if (await this.runtime.imageExists(image)) return image;
    let build = this.building.get(image);
    if (build === undefined) {
      build = this.build(task, definition, key, outputFile, mask).finally(() =>
        this.building.delete(image),
      );
      this.building.set(image, build);
    }
    await build;
    return image;
  }

  /**
   * Removes the Office's images that no Project's current key uses: every image but the newest of
   * each Project's. One a container still uses stays, as the runtime refuses to remove it.
   */
  async sweep(): Promise<void> {
    await rm(this.folders.imageBuilds, { recursive: true, force: true });
    const images = await this.runtime.listImages(officeLabels(this.folders.instance));
    const newest = new Map<string, Date>();
    for (const { name, createdAt } of images) {
      const repository = repositoryOf(name);
      const known = newest.get(repository);
      if (known === undefined || createdAt > known) newest.set(repository, createdAt);
    }
    for (const { name, createdAt } of images) {
      if (newest.get(repositoryOf(name))?.getTime() === createdAt.getTime()) continue;
      await this.runtime.removeImage(name).catch((error: unknown) => {
        this.logger.warn(`The image ${name} was kept: ${String(error)}`);
      });
    }
  }

  private async build(
    task: ImageSource,
    definition: RunEnvironmentDefinition,
    key: string,
    outputFile: string,
    mask: StreamedOutputMask | undefined,
  ): Promise<void> {
    const labels = officeLabels(this.folders.instance);
    const image = imageNameOf(task.projectId, key);
    let from: string;
    if (definition.serviceImage.kind === "build") {
      from = baseImageNameOf(task.projectId, key);
      await note(outputFile, `Building ${from} from the run environment definition.`);
      const { context, dockerfile, args, target } = definition.serviceImage;
      await this.runtime.buildImage(
        {
          image: from,
          context: join(task.worktree, context),
          dockerfile,
          args,
          secrets: {},
          ...(target === undefined ? {} : { target }),
          labels,
        },
        outputFile,
        mask,
      );
    } else {
      from = definition.serviceImage.image;
    }
    await note(outputFile, `Building ${image} with the install command.`);
    const context = this.folders.imageBuildFolder(image);
    try {
      await this.writeInstallContext(task, context, from);
      await this.runtime.buildImage(
        {
          image,
          context,
          dockerfile: "Dockerfile",
          args: {},
          secrets: installSecrets(task.installVariables),
          labels,
        },
        outputFile,
        mask,
      );
    } finally {
      await rm(context, { recursive: true, force: true });
    }
    await this.events.publish(new RunEnvironmentImageBuilt(task.projectId, image));
  }

  /** The Dockerfile that runs the install command, beside a copy of the Install inputs. */
  private async writeInstallContext(
    task: ImageSource,
    context: string,
    from: string,
  ): Promise<void> {
    await rm(context, { recursive: true, force: true });
    const inputs = join(context, INSTALL_INPUTS_FOLDER);
    await mkdir(inputs, { recursive: true });
    for (const input of task.installInputs) {
      const target = join(inputs, input);
      await mkdir(dirname(target), { recursive: true });
      // An Install input not there yet is left out, as its absence is in the key.
      await copyFile(join(task.worktree, input), target).catch(() => undefined);
    }
    const variableNames = task.installVariables.map(({ name }) => name);
    await writeFile(
      join(context, "Dockerfile"),
      installDockerfile(from, task.installCommand, variableNames),
    );
  }
}

/** Writes a line of The Office's own into the output file, between the runtime's. */
export async function note(outputFile: string, line: string): Promise<void> {
  await mkdir(dirname(outputFile), { recursive: true });
  await appendFile(outputFile, `\n[The Office] ${line}\n`);
}

function repositoryOf(image: string): string {
  return image.slice(0, image.lastIndexOf(":"));
}
