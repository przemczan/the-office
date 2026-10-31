import { Body, Controller, Get, Param, Put, UseFilters } from "@nestjs/common";
import {
  projectServerValuesChangeSchema,
  type ProjectMcpServerValues as ProjectMcpServerValuesResponse,
  type ProjectServerValue as ProjectServerValueResponse,
  type ProjectServerValuesChange,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import {
  McpServerRefused,
  ProjectServerValues,
  type ProjectMcpServerValues,
  type ProjectServerValueView,
} from "../../../mcp-servers/index.js";
import { ProjectService } from "../../application/project-service.js";
import { ProjectRefused } from "../../domain/project-refused.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/** The Project page's Server values: its own over the Office-wide ones, a secret's never sent back. */
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
    return (await this.serverValues.of(project.id)).map(toResponse);
  }

  @Put(":id/server-values/:serverName")
  async change(
    @Param("id") id: string,
    @Param("serverName") serverName: string,
    @Body(new ContractPipe(projectServerValuesChangeSchema)) change: ProjectServerValuesChange,
  ): Promise<ProjectMcpServerValuesResponse> {
    const project = await this.projects.read(id);
    const edits = change.serverValues.map(({ name, projectValue }) => ({
      name,
      ...(projectValue !== undefined && { projectValue }),
    }));
    try {
      return toResponse(await this.serverValues.change(project.id, serverName, edits));
    } catch (error) {
      // A change the library refuses is a refused change to the Project, in the same words.
      if (error instanceof McpServerRefused) throw new ProjectRefused(error.reasons);
      throw error;
    }
  }
}

function toResponse({
  serverName,
  serverValues,
}: ProjectMcpServerValues): ProjectMcpServerValuesResponse {
  return { serverName, serverValues: serverValues.map(toServerValueResponse) };
}

function toServerValueResponse({
  serverValue: { name, secret, required, officeWideValue },
  projectValue,
}: ProjectServerValueView): ProjectServerValueResponse {
  return {
    name,
    secret,
    required,
    ...(!secret && officeWideValue !== undefined && { officeWideValue }),
    officeWideValueSet: officeWideValue !== undefined,
    ...(!secret && projectValue !== undefined && { projectValue }),
    projectValueSet: projectValue !== undefined,
  };
}
