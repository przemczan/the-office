import { availableParallelism } from "node:os";
import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { ComposeCommandLine } from "./adapters/compose/compose-command-line.js";
import { ProjectRunEnvironmentsController } from "./adapters/http/project-run-environments.controller.js";
import { RunEnvironmentCpuLimitController } from "./adapters/http/run-environment-cpu-limit.controller.js";
import { ProjectsRepositoryFiles } from "./adapters/projects/projects-repository-files.js";
import { ProjectsSettings } from "./adapters/projects/projects-settings.js";
import { ProjectsSetUpRegistration } from "./adapters/projects/projects-set-up-registration.js";
import { ProjectsTaskRunEnvironments } from "./adapters/projects/projects-task-run-environments.js";
import { WorkSetUpTasks } from "./adapters/work/work-set-up-tasks.js";
import { PostgresRunEnvironmentSettings } from "./adapters/postgres/postgres-run-environment-settings.js";
import { RunEnvironmentWebEvents } from "./adapters/websocket/run-environment-web-events.js";
import { HostCores } from "./application/host-cores.js";
import { ProjectRunEnvironments } from "./application/project-run-environments.js";
import { RunEnvironmentCpuLimits } from "./application/run-environment-cpu-limits.js";
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
  /** This computer's cores, which Automatic follows; `os.availableParallelism()` unless a test gives them. */
  readonly hostCores?: number;
}

@Module({})
export class RunEnvironmentsModule {
  static register({
    imports,
    knownTasks,
    containerRuntime,
    hostCores = availableParallelism(),
  }: RunEnvironmentsModuleOptions): DynamicModule {
    return {
      module: RunEnvironmentsModule,
      imports: [...imports, ScheduleModule, BusyWorkModule],
      controllers: [ProjectRunEnvironmentsController, RunEnvironmentCpuLimitController],
      providers: [
        containerRuntime === undefined
          ? { provide: ContainerRuntime, useClass: ComposeCommandLine }
          : { provide: ContainerRuntime, useValue: containerRuntime },
        { provide: RunEnvironmentSettings, useClass: PostgresRunEnvironmentSettings },
        { provide: HostCores, useValue: new HostCores(hostCores) },
        { provide: KnownTasks, useExisting: knownTasks },
        RunEnvironmentFolders,
        RunEnvironmentImages,
        RunEnvironmentSlots,
        RunEnvironments,
        RunEnvironmentCpuLimits,
        RunEnvironmentWebEvents,
        { provide: ProjectSettings, useClass: ProjectsSettings },
        { provide: RepositoryFiles, useClass: ProjectsRepositoryFiles },
        { provide: SetUpTasks, useClass: WorkSetUpTasks },
        ProjectRunEnvironments,
        ProjectsSetUpRegistration,
        ProjectsTaskRunEnvironments,
      ],
      exports: [RunEnvironments],
    };
  }
}
