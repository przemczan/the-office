import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { GitIdentityModule } from "../../platform/git-identity/git-identity.module.js";
import { EngineModule } from "../engine/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { SkillsModule } from "../skills/index.js";
import { ProjectOfficeTools } from "./adapters/office-tools/project-office-tools.js";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { RepositoryLocks } from "./adapters/git/repository-locks.js";
import { GitHubApiPullRequests } from "./adapters/github/github-api-pull-requests.js";
import { EnvironmentChecksController } from "./adapters/http/environment-checks.controller.js";
import { ProjectServerValuesController } from "./adapters/http/project-server-values.controller.js";
import { ProjectsController } from "./adapters/http/projects.controller.js";
import { RepositoryClonesController } from "./adapters/http/repository-clones.controller.js";
import { TaskChangesController } from "./adapters/http/task-changes.controller.js";
import { PostgresEnvironmentCheckRepository } from "./adapters/postgres/postgres-environment-check-repository.js";
import { PostgresProjectRepository } from "./adapters/postgres/postgres-project-repository.js";
import { ShellCommandRunner } from "./adapters/shell/shell-command-runner.js";
import { ProjectWebEvents } from "./adapters/websocket/project-web-events.js";
import { BaseCheckouts } from "./application/base-checkouts.js";
import { EnvironmentChecks } from "./application/environment-checks.js";
import { LocalRepositories } from "./application/local-repositories.js";
import { RemoteRepositories } from "./application/remote-repositories.js";
import { ProjectChecks } from "./application/project-checks.js";
import { ProjectCommandRunner } from "./application/project-command-runner.js";
import { ProjectRemotes } from "./application/project-remotes.js";
import { ProjectService } from "./application/project-service.js";
import { RepositoryClones } from "./application/repository-clones.js";
import { Publishing } from "./application/publishing.js";
import { Resolving } from "./application/resolving.js";
import { ScriptCommands } from "./application/script-commands.js";
import { TaskWorktrees } from "./application/task-worktrees.js";
import { Worktrees } from "./application/worktrees.js";
import { CommandRunner } from "./ports/command-runner.js";
import { EnvironmentCheckRepository } from "./ports/environment-check-repository.js";
import { Git } from "./ports/git.js";
import { KnownPipelines } from "./ports/known-pipelines.js";
import { ProjectRepository } from "./ports/project-repository.js";
import { PullRequests } from "./ports/pull-requests.js";

export interface ProjectsModuleOptions {
  /**
   * The modules that provide `knownPipelines`, and the github module, whose one instance opens
   * pull requests (`GitHubPullRequests`).
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownPipelines: Type<KnownPipelines>;
}

@Module({})
export class ProjectsModule {
  static register({ imports, knownPipelines }: ProjectsModuleOptions): DynamicModule {
    return {
      module: ProjectsModule,
      // The Project page lists the repository's own skills through the Skills module and keeps its
      // Server values through the MCP servers module; chats read the Projects through an Office
      // tool on the Engine's registry.
      imports: [...imports, GitIdentityModule, SkillsModule, McpServersModule, EngineModule],
      controllers: [
        ProjectsController,
        ProjectServerValuesController,
        EnvironmentChecksController,
        TaskChangesController,
        RepositoryClonesController,
      ],
      providers: [
        { provide: ProjectRepository, useClass: PostgresProjectRepository },
        { provide: EnvironmentCheckRepository, useClass: PostgresEnvironmentCheckRepository },
        { provide: Git, useClass: CommandLineGit },
        RepositoryLocks,
        { provide: PullRequests, useClass: GitHubApiPullRequests },
        { provide: CommandRunner, useClass: ShellCommandRunner },
        ProjectCommandRunner,
        { provide: KnownPipelines, useExisting: knownPipelines },
        EnvironmentChecks,
        RepositoryClones,
        ProjectChecks,
        LocalRepositories,
        RemoteRepositories,
        ProjectService,
        ProjectRemotes,
        Worktrees,
        ScriptCommands,
        Publishing,
        Resolving,
        TaskWorktrees,
        BaseCheckouts,
        ProjectWebEvents,
        ProjectOfficeTools,
      ],
      exports: [BaseCheckouts, ProjectService, TaskWorktrees],
    };
  }
}
