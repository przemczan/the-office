import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { ComposeCommandLine } from "./adapters/compose/compose-command-line.js";
import { ProjectRunEnvironmentsController } from "./adapters/http/project-run-environments.controller.js";
import { ProjectsRepositoryFiles } from "./adapters/projects/projects-repository-files.js";
import { ProjectsSettings } from "./adapters/projects/projects-settings.js";
import { WorkSetUpTasks } from "./adapters/work/work-set-up-tasks.js";
import { PostgresRunEnvironmentSettings } from "./adapters/postgres/postgres-run-environment-settings.js";
import { ProjectRunEnvironments } from "./application/project-run-environments.js";
import { RunEnvironmentFolders } from "./application/run-environment-folders.js";
import { RunEnvironmentImages } from "./application/run-environment-images.js";
import { RunEnvironmentSlots } from "./application/run-environment-slots.js";
import { RunEnvironments } from "./application/run-environments.js";
import { ContainerRuntime } from "./ports/container-runtime.js";
import { KnownTasks } from "./ports/known-tasks.js";
import { ProjectSettings } from "./ports/project-settings.js";
import { RepositoryFiles } from "./ports/repository-files.js";
import { RunEnvironmentSettings } from "./ports/run-environment-settings.js";
import { SetUpTasks } from "./ports/set-up-tasks.js";

export interface RunEnvironmentsModuleOptions {
  /**
   * The modules that provide `knownTasks`, and Projects and Work, whose `ProjectService`,
   * `CommittedFiles` and `RunEnvironmentSetUps` the Project's Run environment setting goes through.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownTasks: Type<KnownTasks>;
  /** The container runtime; the compose CLI unless a test gives a scripted one. */
  readonly containerRuntime?: ContainerRuntime;
}

@Module({})
export class RunEnvironmentsModule {
  static register({
    imports,
    knownTasks,
    containerRuntime,
  }: RunEnvironmentsModuleOptions): DynamicModule {
    return {
      module: RunEnvironmentsModule,
      imports: [...imports, ScheduleModule, BusyWorkModule],
      controllers: [ProjectRunEnvironmentsController],
      providers: [
        containerRuntime === undefined
          ? { provide: ContainerRuntime, useClass: ComposeCommandLine }
          : { provide: ContainerRuntime, useValue: containerRuntime },
        { provide: RunEnvironmentSettings, useClass: PostgresRunEnvironmentSettings },
        { provide: KnownTasks, useExisting: knownTasks },
        RunEnvironmentFolders,
        RunEnvironmentImages,
        RunEnvironmentSlots,
        RunEnvironments,
        { provide: ProjectSettings, useClass: ProjectsSettings },
        { provide: RepositoryFiles, useClass: ProjectsRepositoryFiles },
        { provide: SetUpTasks, useClass: WorkSetUpTasks },
        ProjectRunEnvironments,
      ],
      exports: [RunEnvironments],
    };
  }
}
