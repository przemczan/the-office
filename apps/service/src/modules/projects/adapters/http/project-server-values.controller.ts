import { Controller, Get, Param, UseFilters } from "@nestjs/common";
import type { ProjectMcpServerValues as ProjectMcpServerValuesResponse } from "@the-office/contracts";
import { ProjectServerValues } from "../../../mcp-servers/index.js";
import { ProjectService } from "../../application/project-service.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toProjectMcpServerValuesResponse } from "./project-server-values-responses.js";

/**
 * The Project page's Server values: its own over the Office-wide ones, a secret's never sent back.
 * Changing them is the Office action change_server_values.
 */
@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectServerValuesController {
  constructor(
    private readonly projects: ProjectService,
    private readonly serverValues: ProjectServerValues,
  ) {}

  @Get(":id/server-values")
  async list(@Param("id") id: string): Promise<ProjectMcpServerValuesResponse[]> {
    const project = await this.projects.read(id);
    return (await this.serverValues.of(project.id)).map(toProjectMcpServerValuesResponse);
  }
}
