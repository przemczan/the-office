import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { RepositoryLocks } from "./adapters/git/repository-locks.js";
import { ProjectsController } from "./adapters/http/projects.controller.js";
import { PostgresProjectRepository } from "./adapters/postgres/postgres-project-repository.js";
import { ShellCommandRunner } from "./adapters/shell/shell-command-runner.js";
import { ProjectWebEvents } from "./adapters/websocket/project-web-events.js";
import { ProjectChecks } from "./application/project-checks.js";
import { ProjectCommandRunner } from "./application/project-command-runner.js";
import { ProjectService } from "./application/project-service.js";
import { CommandRunner } from "./ports/command-runner.js";
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
      imports,
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectRepository, useClass: PostgresProjectRepository },
        { provide: Git, useClass: CommandLineGit },
        RepositoryLocks,
        { provide: CommandRunner, useClass: ShellCommandRunner },
        ProjectCommandRunner,
        { provide: KnownPipelines, useExisting: knownPipelines },
        ProjectChecks,
        ProjectService,
        ProjectWebEvents,
      ],
    };
  }
}
