import { Body, Controller, Delete, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  addProjectSchema,
  afterPublishingCommandChangeSchema,
  beforePublishingCommandChangeSchema,
  commandChangeSchema,
  environmentChangeSchema,
  issueSettingsSchema,
  installCommandChangeSchema,
  installInputsChangeSchema,
  projectCommandSchema,
  publishingModeChangeSchema,
  deleteMergedBranchesChangeSchema,
  projectSkillListSchema,
  type AddProject,
  type AfterPublishingCommandChange,
  type BeforePublishingCommandChange,
  type CommandChange,
  type EnvironmentChange,
  type InstallCommandChange,
  type InstallInputsChange,
  type IssueSettings as IssueSettingsChange,
  type Project as ProjectResponse,
  type ProjectRemoteNeeds,
  type RemoteNeeds as RemoteNeedsResponse,
  type ProjectCommand,
  type PublishingModeChange,
  type DeleteMergedBranchesChange,
  type ProjectSkill,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { ProjectSkills } from "../../../skills/index.js";
import type { RemoteNeeds } from "../../../../platform/git-identity/remote-needs.js";
import { ProjectIssueHosts } from "../../application/project-issue-hosts.js";
import { ProjectRemotes } from "../../application/project-remotes.js";
import { ProjectService } from "../../application/project-service.js";
import type { Project } from "../../domain/project.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toProjectResponse } from "./project-responses.js";
import { byUser } from "./setting-changed-by.js";

@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectService,
    private readonly projectSkills: ProjectSkills,
    private readonly remotes: ProjectRemotes,
    private readonly issueHosts: ProjectIssueHosts,
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
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(
      await this.projects.changeInstallCommand(id, commandLine, byUser(signedIn)),
    );
  }

  @Post(":id/commands")
  async addCommand(
    @Param("id") id: string,
    @Body(new ContractPipe(projectCommandSchema)) command: ProjectCommand,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.addCommand(id, command, byUser(signedIn)));
  }

  @Put(":id/commands/:key")
  async changeCommand(
    @Param("id") id: string,
    @Param("key") key: string,
    @Body(new ContractPipe(commandChangeSchema)) change: CommandChange,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeCommand(id, key, change, byUser(signedIn)));
  }

  @Delete(":id/commands/:key")
  async removeCommand(
    @Param("id") id: string,
    @Param("key") key: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.removeCommand(id, key, byUser(signedIn)));
  }

  @Put(":id/install-inputs")
  async changeInstallInputs(
    @Param("id") id: string,
    @Body(new ContractPipe(installInputsChangeSchema)) { installInputs }: InstallInputsChange,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(
      await this.projects.changeInstallInputs(id, installInputs, byUser(signedIn)),
    );
  }

  @Put(":id/environment")
  async changeEnvironment(
    @Param("id") id: string,
    @Body(new ContractPipe(environmentChangeSchema)) { environment }: EnvironmentChange,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeEnvironment(id, environment, byUser(signedIn)));
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

  /** The GitHub issue switches; a label set records the user as who set it. */
  @Put(":id/issue-settings")
  async changeIssueSettings(
    @Param("id") id: string,
    @Body(new ContractPipe(issueSettingsSchema)) settings: IssueSettingsChange,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectResponse> {
    return this.respond(await this.projects.changeIssueSettings(id, settings, userOf(signedIn)));
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
