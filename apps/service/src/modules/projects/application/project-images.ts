import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Project } from "../domain/project.js";
import { asProjectChanges, changeImage } from "../domain/project-changes.js";
import {
  newProjectImage,
  PROJECT_IMAGE_SIZE_LIMIT,
  PROJECT_IMAGE_TOO_LARGE,
  ProjectImageNotFound,
  type ProjectImage,
  type ProjectImageKey,
} from "../domain/project-image.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectImageFiles } from "../ports/project-image-files.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { BaseBranchFiles } from "./base-branch-files.js";

/** A file in the Project's repository, at the commit the user saw it. */
export interface RepositoryImageFile {
  readonly commit: string;
  readonly path: string;
}

export interface OpenedProjectImage {
  readonly image: ProjectImage;
  readonly content: Readable;
}

/**
 * A Project's Icon and Logo. A file is written before the row names it and removed after the row
 * stops naming it, so a Project never names a file that isn't there.
 */
@Injectable()
export class ProjectImages {
  private readonly logger = new Logger(ProjectImages.name);

  constructor(
    private readonly repository: ProjectRepository,
    private readonly files: ProjectImageFiles,
    private readonly events: EventBus,
    private readonly repositoryFiles: BaseBranchFiles,
  ) {}

  /** Refuses, keeping the image the Project has, bytes that can't be an image. */
  async change(projectId: string, key: ProjectImageKey, content: Uint8Array): Promise<Project> {
    const image = newProjectImage(randomUUID(), content);
    await this.files.save(image.id, content);
    try {
      return await this.keep(projectId, key, image);
    } catch (error) {
      await this.files.remove(image.id);
      throw error;
    }
  }

  /** `change` with a copy of the file: nothing ties the image to the repository afterwards. */
  async changeFromRepository(
    projectId: string,
    key: ProjectImageKey,
    { commit, path }: RepositoryImageFile,
  ): Promise<Project> {
    const content = await this.repositoryFiles.file(projectId, commit, path, {
      bytes: PROJECT_IMAGE_SIZE_LIMIT,
      problem: PROJECT_IMAGE_TOO_LARGE,
    });
    return this.change(projectId, key, content);
  }

  async remove(projectId: string, key: ProjectImageKey): Promise<Project> {
    return this.keep(projectId, key, null);
  }

  /** Answers only for an image the Project holds now; one it held before is gone. */
  async open(projectId: string, imageId: string): Promise<OpenedProjectImage> {
    const project = await this.repository.find(projectId);
    if (!project) throw new ProjectNotFound(projectId);
    const image = [project.icon, project.logo].find((held) => held?.id === imageId);
    if (!image) throw new ProjectImageNotFound(projectId, imageId);
    return { image, content: await this.files.open(image.id) };
  }

  private async keep(
    projectId: string,
    key: ProjectImageKey,
    image: ProjectImage | null,
  ): Promise<Project> {
    let replaced: ProjectImage | null | undefined;
    const { project, events } = await this.repository.update(projectId, (current) => {
      replaced = current[key];
      return asProjectChanges(current, changeImage(current, key, image));
    });
    for (const event of events) await this.events.publish(event);
    if (replaced) await this.removeReplaced(replaced);
    return project;
  }

  /** The change is kept by now, so a file left behind doesn't fail it. */
  private async removeReplaced(image: ProjectImage): Promise<void> {
    try {
      await this.files.remove(image.id);
    } catch (error) {
      this.logger.warn(`Could not remove image ${image.id}: ${(error as Error).message}`);
    }
  }
}
