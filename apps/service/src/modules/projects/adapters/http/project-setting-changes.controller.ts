import { Controller, Get, Param, UseFilters } from "@nestjs/common";
import type { ProjectSettingChanges as ProjectSettingChangesResponse } from "@the-office/contracts";
import { ProjectSettingChanges } from "../../application/project-setting-changes.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/** How many of a Project's newest setting changes its Recent activity reads. */
const LATEST_SETTING_CHANGES = 20;

/** The record of a Project's everyday settings' changes, for its Recent activity. */
@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectSettingChangesController {
  constructor(private readonly settingChanges: ProjectSettingChanges) {}

  @Get(":id/setting-changes")
  async latest(@Param("id") id: string): Promise<ProjectSettingChangesResponse> {
    const changes = await this.settingChanges.latestOf(id, LATEST_SETTING_CHANGES);
    return {
      changes: changes.map(({ id: changeId, setting, summary, by, at }) => ({
        id: changeId,
        setting,
        summary,
        by,
        at: at.toISOString(),
      })),
    };
  }
}
