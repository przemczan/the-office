import { Body, Controller, Delete, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  addProjectSchema,
  afterPublishingCommandChangeSchema,
  beforePublishingCommandChangeSchema,
  commandChangeSchema,
  defaultPipelineChangeSchema,
  environmentChangeSchema,
  issueSettingsSchema,
  projectFeaturesChangeSchema,
  kindDefaultPipelineChangeSchema,
  installCommandChangeSchema,
  installInputsChangeSchema,
  markChangeSchema,
  projectCommandSchema,
  publishingModeChangeSchema,
  deleteMergedBranchesChangeSchema,
  projectEngineChangeSchema,
  projectLimitSchema,
  projectSkillListSchema,
  projectSkillUseChangeSchema,
  useProjectSkillsChangeSchema,
  type AddProject,
  type AfterPublishingCommandChange,
  type BeforePublishingCommandChange,
  type CommandChange,
  type DefaultPipelineChange,
  type EnvironmentChange,
  type InstallCommandChange,
  type InstallInputsChange,
  type IssueSettings as IssueSettingsChange,
  type KindDefaultPipelineChange,
  type MarkChange,
  type Project as ProjectResponse,
  type ProjectEngineChange,
  type ProjectFeaturesChange,
  type ProjectLimitChange,
  type ProjectRemoteNeeds,
  type RemoteNeeds as RemoteNeedsResponse,
  type ProjectCommand,
  type PublishingModeChange,
  type DeleteMergedBranchesChange,
  type ProjectSkill,
  type ProjectSkillUseChange,
  type UseProjectSkillsChange,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { ProjectSkills } from "../../../skills/index.js";
import type { RemoteNeeds } from "../../../../platform/git-identity/remote-needs.js";
import { ProjectFeatures } from "../../application/project-features.js";
import { ProjectIssueHosts } from "../../application/project-issue-hosts.js";
import { ProjectRemotes } from "../../application/project-remotes.js";
import { ProjectService } from "../../application/project-service.js";
import type { Project } from "../../domain/project.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toProjectResponse } from "./project-responses.js";

@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectService,
    private readonly projectSkills: ProjectSkills,
    private readonly remotes: ProjectRemotes,
    private readonly issueHosts: ProjectIssueHosts,
    private readonly features: ProjectFeatures,
  ) {}

  /** The Project as the API shows it, with its code host read from git's config. */
  private async respond(project: Project): Promise<ProjectResponse> {
    return toProjectResponse(project, await this.issueHosts.codeHostNameOf(project));
  }

  @Post()
  async add(
    @Body(new ContractPipe(addProjectSchema)) { runEnvironmentAnswer, ...newProject }: AddProject,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(
      await this.projects.add(
        newProject,
        runEnvironmentAnswer && { answer: runEnvironmentAnswer, by: userOf(signedIn) },
      ),
    );
  }

  @Get()
  async list(): Promise<ProjectResponse[]> {
    return Promise.all((await this.projects.list()).map((project) => this.respond(project)));
  }

  @Get(":id")
  async read(@Param("id") id: string): Promise<ProjectResponse> {
    return this.respond(await this.projects.read(id));
  }

  @Put(":id/install-command")
  async changeInstallCommand(
    @Param("id") id: string,
    @Body(new ContractPipe(installCommandChangeSchema)) { commandLine }: InstallCommandChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeInstallCommand(id, commandLine));
  }

  @Post(":id/commands")
  async addCommand(
    @Param("id") id: string,
    @Body(new ContractPipe(projectCommandSchema)) command: ProjectCommand,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.addCommand(id, command));
  }

  @Put(":id/commands/:key")
  async changeCommand(
    @Param("id") id: string,
    @Param("key") key: string,
    @Body(new ContractPipe(commandChangeSchema)) change: CommandChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeCommand(id, key, change));
  }

  @Delete(":id/commands/:key")
  async removeCommand(
    @Param("id") id: string,
    @Param("key") key: string,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.removeCommand(id, key));
  }

  @Put(":id/install-inputs")
  async changeInstallInputs(
    @Param("id") id: string,
    @Body(new ContractPipe(installInputsChangeSchema)) { installInputs }: InstallInputsChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeInstallInputs(id, installInputs));
  }

  @Put(":id/environment")
  async changeEnvironment(
    @Param("id") id: string,
    @Body(new ContractPipe(environmentChangeSchema)) { environment }: EnvironmentChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeEnvironment(id, environment));
  }

  @Put(":id/publishing-mode")
  async changePublishingMode(
    @Param("id") id: string,
    @Body(new ContractPipe(publishingModeChangeSchema)) { publishingMode }: PublishingModeChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changePublishingMode(id, publishingMode));
  }

  @Put(":id/delete-merged-branches")
  async changeDeleteMergedBranches(
    @Param("id") id: string,
    @Body(new ContractPipe(deleteMergedBranchesChangeSchema)) { on }: DeleteMergedBranchesChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeDeleteMergedBranches(id, on));
  }

  @Put(":id/before-publishing-command")
  async changeBeforePublishingCommand(
    @Param("id") id: string,
    @Body(new ContractPipe(beforePublishingCommandChangeSchema))
    { commandLine }: BeforePublishingCommandChange,
  ): Promise<ProjectResponse> {
    return this.respond(
      await this.projects.changePublishingLine(id, "beforePublishingCommand", commandLine),
    );
  }

  @Put(":id/after-publishing-command")
  async changeAfterPublishingCommand(
    @Param("id") id: string,
    @Body(new ContractPipe(afterPublishingCommandChangeSchema))
    { commandLine }: AfterPublishingCommandChange,
  ): Promise<ProjectResponse> {
    return this.respond(
      await this.projects.changePublishingLine(id, "afterPublishingCommand", commandLine),
    );
  }

  @Put(":id/project-limit")
  async changeProjectLimit(
    @Param("id") id: string,
    @Body(new ContractPipe(projectLimitSchema)) { projectLimit }: ProjectLimitChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeProjectLimit(id, projectLimit));
  }

  @Put(":id/mark")
  async changeMark(
    @Param("id") id: string,
    @Body(new ContractPipe(markChangeSchema)) { mark }: MarkChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeMark(id, mark));
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
    return this.respond(await this.projects.changeUseProjectSkills(id, useProjectSkills));
  }

  @Put(":id/skill-use")
  async changeProjectSkillUse(
    @Param("id") id: string,
    @Body(new ContractPipe(projectSkillUseChangeSchema)) { key, use }: ProjectSkillUseChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeProjectSkillUse(id, key, use));
  }

  @Put(":id/default-pipeline")
  async changeDefaultPipeline(
    @Param("id") id: string,
    @Body(new ContractPipe(defaultPipelineChangeSchema)) { defaultPipeline }: DefaultPipelineChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeDefaultPipeline(id, defaultPipeline));
  }

  /** A Kind's own default Pipeline; null follows the Project's default Pipeline. */
  @Put(":id/kind-default-pipeline")
  async changeKindDefaultPipeline(
    @Param("id") id: string,
    @Body(new ContractPipe(kindDefaultPipelineChangeSchema))
    { kind, pipelineId }: KindDefaultPipelineChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeKindDefaultPipeline(id, kind, pipelineId));
  }

  /** The GitHub issue switches; a label set records the user as who set it. */
  @Put(":id/issue-settings")
  async changeIssueSettings(
    @Param("id") id: string,
    @Body(new ContractPipe(issueSettingsSchema)) settings: IssueSettingsChange,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeIssueSettings(id, settings, userOf(signedIn)));
  }

  /** The feature switches named, others kept; Run environment changes through its own route. */
  @Put(":id/features")
  async changeFeatures(
    @Param("id") id: string,
    @Body(new ContractPipe(projectFeaturesChangeSchema)) { features }: ProjectFeaturesChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.features.change(id, features));
  }

  /** Each level sent replaces the Project's; one left out stays (spec §5.4.5, "The API"). */
  @Put(":id/engine")
  async changeEngine(
    @Param("id") id: string,
    @Body(new ContractPipe(projectEngineChangeSchema)) change: ProjectEngineChange,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeEngine(id, change));
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
