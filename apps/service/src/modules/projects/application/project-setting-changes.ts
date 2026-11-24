import { Injectable } from "@nestjs/common";
import type { ProjectSettingChange } from "../domain/project-setting-change.js";
import { ProjectSettingChangeRepository } from "../ports/project-setting-change-repository.js";
import { ProjectService } from "./project-service.js";

/**
 * The record of a Project's everyday settings' changes, read for its Recent activity. Written only
 * by the services that save each setting, with the change.
 */
@Injectable()
export class ProjectSettingChanges {
  constructor(
    private readonly projects: ProjectService,
    private readonly repository: ProjectSettingChangeRepository,
  ) {}

  /** The Project's `limit` newest changes, newest first; throws ProjectNotFound for no Project. */
  async latestOf(projectId: string, limit: number): Promise<readonly ProjectSettingChange[]> {
    await this.projects.read(projectId);
    return this.repository.latestOf(projectId, limit);
  }
}
