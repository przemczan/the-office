import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { PostgresProjectRepository } from "./adapters/postgres/postgres-project-repository.js";
import { ProjectChecks } from "./application/project-checks.js";
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
      providers: [
        { provide: ProjectRepository, useClass: PostgresProjectRepository },
        { provide: Git, useClass: CommandLineGit },
        { provide: KnownPipelines, useExisting: knownPipelines },
        ProjectChecks,
      ],
    };
  }
}
