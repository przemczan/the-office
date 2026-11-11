import { Body, Controller, Delete, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  addProjectSchema,
  commandChangeSchema,
  defaultPipelineChangeSchema,
  installCommandChangeSchema,
  installInputsChangeSchema,
  markChangeSchema,
  projectCommandSchema,
  publishingModeChangeSchema,
  projectDefaultChangeSchema,
  projectLimitSchema,
  projectSkillListSchema,
  roleOverrideChangeSchema,
  useForEveryRoleChangeSchema,
  projectSkillUseChangeSchema,
  useProjectSkillsChangeSchema,
  type AddProject,
  type CommandChange,
  type DefaultPipelineChange,
  type InstallCommandChange,
  type InstallInputsChange,
  type MarkChange,
  type Project as ProjectResponse,
  type ProjectDefaultChange,
  type ProjectLimitChange,
  type RoleOverrideChange,
  type UseForEveryRoleChange,
  type ProjectRemoteNeeds,
  type RemoteNeeds as RemoteNeedsResponse,
  type ProjectCommand,
  type PublishingModeChange,
  type ProjectSkill,
  type ProjectSkillUseChange,
  type UseProjectSkillsChange,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { ProjectSkills } from "../../../skills/index.js";
import type { RemoteNeeds } from "../../../../platform/git-identity/remote-needs.js";
import { ProjectRemotes } from "../../application/project-remotes.js";
import { ProjectService } from "../../application/project-service.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toProjectResponse } from "./project-responses.js";

@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectService,
    private readonly projectSkills: ProjectSkills,
    private readonly remotes: ProjectRemotes,
  ) {}

  @Post()
  async add(
    @Body(new ContractPipe(addProjectSchema)) { runEnvironmentAnswer, ...newProject }: AddProject,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.add(newProject, runEnvironmentAnswer));
  }

  @Get()
  async list(): Promise<ProjectResponse[]> {
    return (await this.projects.list()).map(toProjectResponse);
  }

  @Get(":id")
  async read(@Param("id") id: string): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.read(id));
  }

  @Put(":id/install-command")
  async changeInstallCommand(
    @Param("id") id: string,
    @Body(new ContractPipe(installCommandChangeSchema)) { commandLine }: InstallCommandChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeInstallCommand(id, commandLine));
  }

  @Post(":id/commands")
  async addCommand(
    @Param("id") id: string,
    @Body(new ContractPipe(projectCommandSchema)) command: ProjectCommand,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.addCommand(id, command));
  }

  @Put(":id/commands/:key")
  async changeCommand(
    @Param("id") id: string,
    @Param("key") key: string,
    @Body(new ContractPipe(commandChangeSchema)) change: CommandChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeCommand(id, key, change));
  }

  @Delete(":id/commands/:key")
  async removeCommand(
    @Param("id") id: string,
    @Param("key") key: string,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.removeCommand(id, key));
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

  @Put(":id/project-limit")
  async changeProjectLimit(
    @Param("id") id: string,
    @Body(new ContractPipe(projectLimitSchema)) { projectLimit }: ProjectLimitChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeProjectLimit(id, projectLimit));
  }

  @Put(":id/mark")
  async changeMark(
    @Param("id") id: string,
    @Body(new ContractPipe(markChangeSchema)) { mark }: MarkChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeMark(id, mark));
  }

  /**
   * Which part of the Office identity the base branch's remote needs, read from the repository
   * each time; apart from the record, so a list of Projects runs no git.
   */
  @Get(":id/remote-needs")
  async remoteNeeds(@Param("id") id: string): Promise<ProjectRemoteNeeds> {
    const needs = await this.remotes.needsOf(await this.projects.read(id));
    return { remoteNeeds: needs === undefined ? null : toRemoteNeedsResponse(needs) };
  }

  /** The repository's own skills and commands, read from its checkout; never stored. */
  @Get(":id/skills")
  async skills(@Param("id") id: string): Promise<ProjectSkill[]> {
    const project = await this.projects.read(id);
    return projectSkillListSchema.parse(await this.projectSkills.of(project.id, project.path));
  }

  @Put(":id/use-project-skills")
  async changeUseProjectSkills(
    @Param("id") id: string,
    @Body(new ContractPipe(useProjectSkillsChangeSchema))
    { useProjectSkills }: UseProjectSkillsChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeUseProjectSkills(id, useProjectSkills));
  }

  @Put(":id/skill-use")
  async changeProjectSkillUse(
    @Param("id") id: string,
    @Body(new ContractPipe(projectSkillUseChangeSchema)) { key, use }: ProjectSkillUseChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeProjectSkillUse(id, key, use));
  }

  @Put(":id/default-pipeline")
  async changeDefaultPipeline(
    @Param("id") id: string,
    @Body(new ContractPipe(defaultPipelineChangeSchema)) { defaultPipeline }: DefaultPipelineChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeDefaultPipeline(id, defaultPipeline));
  }

  @Put(":id/project-default")
  async changeProjectDefault(
    @Param("id") id: string,
    @Body(new ContractPipe(projectDefaultChangeSchema)) { projectDefault }: ProjectDefaultChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeProjectDefault(id, projectDefault));
  }

  @Put(":id/use-for-every-role")
  async changeUseForEveryRole(
    @Param("id") id: string,
    @Body(new ContractPipe(useForEveryRoleChangeSchema)) { useForEveryRole }: UseForEveryRoleChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeUseForEveryRole(id, useForEveryRole));
  }

  @Put(":id/role-overrides/:roleKey")
  async changeRoleOverride(
    @Param("id") id: string,
    @Param("roleKey") roleKey: string,
    @Body(new ContractPipe(roleOverrideChangeSchema)) { roleOverride }: RoleOverrideChange,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.projects.changeRoleOverride(id, roleKey, roleOverride));
  }
}

function toRemoteNeedsResponse(needs: RemoteNeeds): RemoteNeedsResponse {
  switch (needs.kind) {
    case "github-https":
      return { kind: needs.kind, missing: [...needs.missing] };
    case "ssh":
      return { kind: needs.kind, host: needs.host, port: needs.port, missing: [...needs.missing] };
    default:
      return needs;
  }
}
