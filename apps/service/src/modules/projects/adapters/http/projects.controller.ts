import { Body, Controller, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  commandChangeSchema,
  defaultPipelineChangeSchema,
  installInputsChangeSchema,
  newProjectSchema,
  projectCommandKeySchema,
  publishingModeChangeSchema,
  type CommandChange,
  type DefaultPipelineChange,
  type InstallInputsChange,
  type NewProject,
  type Project as ProjectResponse,
  type ProjectCommandKey,
  type PublishingModeChange,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { ProjectService } from "../../application/project-service.js";
import type { Project } from "../../domain/project.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Post()
  async add(
    @Body(new ContractPipe(newProjectSchema)) newProject: NewProject,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.add(newProject));
  }

  @Get()
  async list(): Promise<ProjectResponse[]> {
    return (await this.projects.list()).map(toProjectResponse);
  }

  @Get(":id")
  async read(@Param("id") id: string): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.read(id));
  }

  @Put(":id/commands/:key")
  async changeCommand(
    @Param("id") id: string,
    @Param("key", new ContractPipe(projectCommandKeySchema)) key: ProjectCommandKey,
    @Body(new ContractPipe(commandChangeSchema)) { commandLine }: CommandChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeCommand(id, key, commandLine));
  }

  @Put(":id/install-inputs")
  async changeInstallInputs(
    @Param("id") id: string,
    @Body(new ContractPipe(installInputsChangeSchema)) { installInputs }: InstallInputsChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeInstallInputs(id, installInputs));
  }

  @Put(":id/publishing-mode")
  async changePublishingMode(
    @Param("id") id: string,
    @Body(new ContractPipe(publishingModeChangeSchema)) { publishingMode }: PublishingModeChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changePublishingMode(id, publishingMode));
  }

  @Put(":id/default-pipeline")
  async changeDefaultPipeline(
    @Param("id") id: string,
    @Body(new ContractPipe(defaultPipelineChangeSchema)) { defaultPipeline }: DefaultPipelineChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeDefaultPipeline(id, defaultPipeline));
  }
}

function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    baseBranch: project.baseBranch,
    mark: { label: project.mark.label, colour: project.mark.colour },
    commands: { ...project.commands },
    installInputs: [...project.installInputs],
    publishingMode: project.publishingMode,
    defaultPipeline: project.defaultPipeline,
    environment: {
      set: project.environment.set.map(({ name, value }) => ({ name, value })),
      unset: [...project.environment.unset],
      prependPath: [...project.environment.prependPath],
    },
    useProjectSkills: project.useProjectSkills,
    addedAt: project.addedAt.toISOString(),
  };
}
