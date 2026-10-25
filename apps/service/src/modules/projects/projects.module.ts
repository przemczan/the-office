import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { SkillsModule } from "../skills/index.js";
import { ProjectOfficeTools } from "./adapters/office-tools/project-office-tools.js";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { RepositoryLocks } from "./adapters/git/repository-locks.js";
import { EnvironmentChecksController } from "./adapters/http/environment-checks.controller.js";
import { ProjectsController } from "./adapters/http/projects.controller.js";
import { PostgresEnvironmentCheckRepository } from "./adapters/postgres/postgres-environment-check-repository.js";
import { PostgresProjectRepository } from "./adapters/postgres/postgres-project-repository.js";
import { ShellCommandRunner } from "./adapters/shell/shell-command-runner.js";
import { ProjectWebEvents } from "./adapters/websocket/project-web-events.js";
import { BaseCheckouts } from "./application/base-checkouts.js";
import { EnvironmentChecks } from "./application/environment-checks.js";
import { ProjectChecks } from "./application/project-checks.js";
import { ProjectCommandRunner } from "./application/project-command-runner.js";
import { ProjectService } from "./application/project-service.js";
import { Worktrees } from "./application/worktrees.js";
import { CommandRunner } from "./ports/command-runner.js";
import { EnvironmentCheckRepository } from "./ports/environment-check-repository.js";
import { Git } from "./ports/git.js";
import { KnownPipelines } from "./ports/known-pipelines.js";
import { ProjectRepository } from "./ports/project-repository.js";

export interface ProjectsModuleOptions {
  /** The modules that provide `knownPipelines`. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownPipelines: Type<KnownPipelines>;
}

@Module({})
export class ProjectsModule {
  static register({ imports, knownPipelines }: ProjectsModuleOptions): DynamicModule {
    return {
      module: ProjectsModule,
      // The Project page lists the repository's own skills through the Skills module; chats read
      // the Projects through an Office tool on the Engine's registry.
      imports: [...imports, SkillsModule, EngineModule],
      controllers: [ProjectsController, EnvironmentChecksController],
      providers: [
        { provide: ProjectRepository, useClass: PostgresProjectRepository },
        { provide: EnvironmentCheckRepository, useClass: PostgresEnvironmentCheckRepository },
        { provide: Git, useClass: CommandLineGit },
        RepositoryLocks,
        { provide: CommandRunner, useClass: ShellCommandRunner },
        ProjectCommandRunner,
        { provide: KnownPipelines, useExisting: knownPipelines },
        EnvironmentChecks,
        ProjectChecks,
        ProjectService,
        Worktrees,
        BaseCheckouts,
        ProjectWebEvents,
        ProjectOfficeTools,
      ],
      exports: [BaseCheckouts, ProjectService],
    };
  }
}
