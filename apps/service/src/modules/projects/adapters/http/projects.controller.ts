import { Body, Controller, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  commandChangeSchema,
  defaultPipelineChangeSchema,
  installInputsChangeSchema,
  newProjectSchema,
  projectCommandKeySchema,
  publishingModeChangeSchema,
  projectDefaultChangeSchema,
  projectSkillListSchema,
  roleOverrideChangeSchema,
  useForEveryRoleChangeSchema,
  projectSkillUseChangeSchema,
  useProjectSkillsChangeSchema,
  type CommandChange,
  type DefaultPipelineChange,
  type InstallInputsChange,
  type NewProject,
  type Project as ProjectResponse,
  type ProjectDefaultChange,
  type RoleOverrideChange,
  type UseForEveryRoleChange,
  type ProjectRemoteNeeds,
  type RemoteNeeds as RemoteNeedsResponse,
  type ProjectCommandKey,
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
import type { Project } from "../../domain/project.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

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
    return projectSkillListSchema.parse(await this.projectSkills.of(project.path));
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

function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    repositoryUrl: project.repositoryUrl,
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
    projectSkillsOff: [...project.projectSkillsOff],
    projectDefault: project.projectDefault && { ...project.projectDefault },
    useForEveryRole: project.useForEveryRole,
    roleOverrides: project.roleOverrides.map(({ roleKey, engineId, model }) => ({
      roleKey,
      engineId,
      model,
    })),
    addedAt: project.addedAt.toISOString(),
  };
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
