import {
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type ModuleMetadata,
  type NestModule,
  type Type,
} from "@nestjs/common";
import { IMAGE_UPLOAD_BYTES } from "@the-office/contracts";
import { GitIdentityModule } from "../../platform/git-identity/git-identity.module.js";
import { uploadBody } from "../../platform/http/upload-body.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ImageFolder } from "../../platform/images/image-folder.js";
import { OfficeDataDirectory } from "../../platform/office-data/office-data-directory.js";
import { EngineModule } from "../engine/index.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { SkillsModule } from "../skills/index.js";
import { ProjectOfficeActions } from "./adapters/office-actions/project-office-actions.js";
import { ProjectOfficeTools } from "./adapters/office-tools/project-office-tools.js";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { RepositoryLocks } from "./adapters/git/repository-locks.js";
import { GitHubCodeHost } from "./adapters/github/github-code-host.js";
import { RepositoryFilesController } from "./adapters/http/repository-files.controller.js";
import { CiRunsController } from "./adapters/http/ci-runs.controller.js";
import { IssuesController } from "./adapters/http/issues.controller.js";
import { EnvironmentChecksController } from "./adapters/http/environment-checks.controller.js";
import { ProjectImagesController } from "./adapters/http/project-images.controller.js";
import { ProjectOfficeActionsController } from "./adapters/http/project-office-actions.controller.js";
import { ProjectServerValuesController } from "./adapters/http/project-server-values.controller.js";
import { ProjectTestTargetsController } from "./adapters/http/project-test-targets.controller.js";
import { ProjectsController } from "./adapters/http/projects.controller.js";
import { PullRequestsController } from "./adapters/http/pull-requests.controller.js";
import { RepositoryClonesController } from "./adapters/http/repository-clones.controller.js";
import { TaskChangesController } from "./adapters/http/task-changes.controller.js";
import { PostgresIssueLinkRepository } from "./adapters/postgres/postgres-issue-link-repository.js";
import { PostgresEnvironmentCheckRepository } from "./adapters/postgres/postgres-environment-check-repository.js";
import { PostgresProjectRepository } from "./adapters/postgres/postgres-project-repository.js";
import { PostgresPullRequestRepository } from "./adapters/postgres/postgres-pull-request-repository.js";
import { PostgresTestTargetRepository } from "./adapters/postgres/postgres-test-target-repository.js";
import { ShellCommandRunner } from "./adapters/shell/shell-command-runner.js";
import { CiRunWebEvents } from "./adapters/websocket/ci-run-web-events.js";
import { IssueWebEvents } from "./adapters/websocket/issue-web-events.js";
import { ProjectWebEvents } from "./adapters/websocket/project-web-events.js";
import { PullRequestWebEvents } from "./adapters/websocket/pull-request-web-events.js";
import { RepositoryFiles } from "./application/repository-files.js";
import { BaseCheckouts } from "./application/base-checkouts.js";
import { CiRunWatch } from "./application/ci-run-watch.js";
import { CodeHosts } from "./application/code-hosts.js";
import { ManualWorkflows } from "./application/manual-workflows.js";
import { ProjectRecords } from "./application/project-records.js";
import { CommittedFiles } from "./application/committed-files.js";
import { EngineLevelsChecks } from "./application/engine-levels-checks.js";
import { RunEnvironmentSetUpRegistry } from "./application/run-environment-set-up-registry.js";
import { DevcontainerServices } from "./application/devcontainer-services.js";
import { TestTargets } from "./application/test-targets.js";
import { TestTargetRepository } from "./ports/test-target-repository.js";
import { TaskCommandRunner } from "./application/task-command-runner.js";
import { TaskRunEnvironments } from "./application/task-run-environments.js";
import { EnvironmentChecks } from "./application/environment-checks.js";
import { InitiativeBranches } from "./application/initiative-branches.js";
import { LocalRepositories } from "./application/local-repositories.js";
import { RepositoriesByUrl } from "./application/repositories-by-url.js";
import { ProjectChecks } from "./application/project-checks.js";
import { ProjectCommandRunner } from "./application/project-command-runner.js";
import { ProjectImages } from "./application/project-images.js";
import { ProjectRemotes } from "./application/project-remotes.js";
import { ProjectLevelMoves } from "./application/project-level-moves.js";
import { ProjectService } from "./application/project-service.js";
import { ProjectsFromRepositories } from "./application/projects-from-repositories.js";
import { RepositoryClones } from "./application/repository-clones.js";
import { Publishing } from "./application/publishing.js";
import { PullRequestActions } from "./application/pull-request-actions.js";
import { PullRequestRecords } from "./application/pull-request-records.js";
import { PullRequestWatch } from "./application/pull-request-watch.js";
import { BranchUpdates } from "./application/branch-updates.js";
import { Resolving } from "./application/resolving.js";
import { ScriptCommands } from "./application/script-commands.js";
import { AgentCommands } from "./application/agent-commands.js";
import { IssueFixes } from "./application/issue-fixes.js";
import { IssueImport } from "./application/issue-import.js";
import { IssueTasks } from "./application/issue-tasks.js";
import { IssueWatch } from "./application/issue-watch.js";
import { IssueWriteBack } from "./application/issue-write-back.js";
import { IssueWriteBacks } from "./application/issue-write-backs.js";
import { ProjectIssueHosts } from "./application/project-issue-hosts.js";
import { TaskBases } from "./application/task-bases.js";
import { TaskWorktrees } from "./application/task-worktrees.js";
import { Worktrees } from "./application/worktrees.js";
import { CommandRunner } from "./ports/command-runner.js";
import { EnvironmentCheckRepository } from "./ports/environment-check-repository.js";
import { IssueLinkRepository } from "./ports/issue-link-repository.js";
import { Git } from "./ports/git.js";
import { KnownPipelines } from "./ports/known-pipelines.js";
import { ProjectImageFiles } from "./ports/project-image-files.js";
import { ProjectRepository } from "./ports/project-repository.js";
import { PullRequestRepository } from "./ports/pull-request-repository.js";

export interface ProjectsModuleOptions {
  /**
   * The modules that provide `knownPipelines`, and the github module, whose one instance opens
   * and reads pull requests (`GitHubPullRequests`).
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownPipelines: Type<KnownPipelines>;
}

@Module({})
export class ProjectsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(IMAGE_UPLOAD_BYTES))
      .forRoutes({ path: "projects/:id/images/:image/:palette", method: RequestMethod.POST });
  }

  static register({ imports, knownPipelines }: ProjectsModuleOptions): DynamicModule {
    return {
      module: ProjectsModule,
      // The Project page lists the repository's own skills through the Skills module and keeps its
      // Server values through the MCP servers module; chats read the Projects through an Office
      // tool on the Engine's registry, which carries Projects' Office actions too.
      imports: [
        ...imports,
        GitIdentityModule,
        SkillsModule,
        McpServersModule,
        EngineModule,
        BusyWorkModule,
        ScheduleModule,
      ],
      controllers: [
        ProjectsController,
        ProjectImagesController,
        ProjectServerValuesController,
        ProjectTestTargetsController,
        EnvironmentChecksController,
        TaskChangesController,
        RepositoryFilesController,
        RepositoryClonesController,
        PullRequestsController,
        CiRunsController,
        IssuesController,
        ProjectOfficeActionsController,
      ],
      providers: [
        { provide: ProjectRepository, useClass: PostgresProjectRepository },
        { provide: EnvironmentCheckRepository, useClass: PostgresEnvironmentCheckRepository },
        {
          provide: ProjectImageFiles,
          inject: [OfficeDataDirectory],
          useFactory: (officeData: OfficeDataDirectory) =>
            new ImageFolder(officeData.folder("project-images")),
        },
        { provide: Git, useClass: CommandLineGit },
        RepositoryLocks,
        { provide: PullRequestRepository, useClass: PostgresPullRequestRepository },
        { provide: IssueLinkRepository, useClass: PostgresIssueLinkRepository },
        { provide: TestTargetRepository, useClass: PostgresTestTargetRepository },
        GitHubCodeHost,
        // Each remote's pull requests and CI runs go to the first host that reaches its URL; another host,
        // such as GitLab, is one more adapter of `CodeHost` in this list.
        {
          provide: CodeHosts,
          inject: [GitHubCodeHost],
          useFactory: (gitHub: GitHubCodeHost) => new CodeHosts([gitHub]),
        },
        PullRequestWatch,
        CiRunWatch,
        ManualWorkflows,
        PullRequestActions,
        { provide: CommandRunner, useClass: ShellCommandRunner },
        ProjectCommandRunner,
        TaskRunEnvironments,
        TaskCommandRunner,
        { provide: KnownPipelines, useExisting: knownPipelines },
        EnvironmentChecks,
        RepositoryClones,
        ProjectChecks,
        EngineLevelsChecks,
        RunEnvironmentSetUpRegistry,
        DevcontainerServices,
        TestTargets,
        LocalRepositories,
        RepositoriesByUrl,
        ProjectService,
        ProjectImages,
        ProjectLevelMoves,
        ProjectsFromRepositories,
        ProjectRemotes,
        Worktrees,
        TaskBases,
        IssueTasks,
        ProjectIssueHosts,
        IssueImport,
        IssueFixes,
        IssueWriteBacks,
        { provide: IssueWriteBack, useExisting: IssueWriteBacks },
        IssueWatch,
        IssueWebEvents,
        ScriptCommands,
        AgentCommands,
        Publishing,
        Resolving,
        BranchUpdates,
        TaskWorktrees,
        BaseCheckouts,
        RepositoryFiles,
        CommittedFiles,
        InitiativeBranches,
        ProjectWebEvents,
        PullRequestWebEvents,
        CiRunWebEvents,
        ProjectOfficeTools,
        ProjectOfficeActions,
        ProjectRecords,
        PullRequestRecords,
      ],
      exports: [
        BaseCheckouts,
        CommittedFiles,
        EngineLevelsChecks,
        InitiativeBranches,
        RunEnvironmentSetUpRegistry,
        DevcontainerServices,
        TestTargets,
        ProjectRecords,
        ProjectService,
        ProjectsFromRepositories,
        PullRequestRecords,
        TaskRunEnvironments,
        TaskWorktrees,
        TaskBases,
        IssueTasks,
        IssueWriteBack,
      ],
    };
  }
}
