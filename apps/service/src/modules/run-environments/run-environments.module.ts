import { availableParallelism } from "node:os";
import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { currentOperatingSystem } from "../../platform/os/current-operating-system.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { ComposeCommandLine } from "./adapters/compose/compose-command-line.js";
import { ProjectRunEnvironmentsController } from "./adapters/http/project-run-environments.controller.js";
import { RunEnvironmentOfficeLimitsController } from "./adapters/http/run-environment-office-limits.controller.js";
import { ProjectsRepositoryFiles } from "./adapters/projects/projects-repository-files.js";
import { ProjectsSettings } from "./adapters/projects/projects-settings.js";
import { ProjectsDevcontainerServicesRegistration } from "./adapters/projects/projects-devcontainer-services-registration.js";
import { ProjectsSetUpRegistration } from "./adapters/projects/projects-set-up-registration.js";
import { ProjectsTaskRunEnvironments } from "./adapters/projects/projects-task-run-environments.js";
import { WorkSetUpTasks } from "./adapters/work/work-set-up-tasks.js";
import { PostgresRunEnvironmentSettings } from "./adapters/postgres/postgres-run-environment-settings.js";
import { RunEnvironmentWebEvents } from "./adapters/websocket/run-environment-web-events.js";
import { DeviceHelperFiles, DeviceHelperSource } from "./application/device-helper-files.js";
import { HostCores } from "./application/host-cores.js";
import {
  HostedServiceReadiness,
  type HostedServiceReadinessOptions,
} from "./application/hosted-service-readiness.js";
import { HostedServices } from "./application/hosted-services.js";
import { ProjectRunEnvironments } from "./application/project-run-environments.js";
import { RunEnvironmentCommandVariables } from "./application/run-environment-command-variables.js";
import { RunEnvironmentDefinitions } from "./application/run-environment-definitions.js";
import { RunEnvironmentOfficeLimits } from "./application/run-environment-office-limits.js";
import { RunEnvironmentFolders } from "./application/run-environment-folders.js";
import { RunEnvironmentImages } from "./application/run-environment-images.js";
import { RunEnvironmentSlots } from "./application/run-environment-slots.js";
import { RunEnvironments } from "./application/run-environments.js";
import { ServiceOwner, serviceOwnerOf } from "./application/service-owner.js";
import type { FileOwnerIds } from "./domain/run-environment.js";
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
  /**
   * The user and group checks' files are handed back to; the operating system's file owner unless
   * a test gives one, none for root.
   */
  readonly serviceOwner?: FileOwnerIds;
  /**
   * How long a Hosted Test instance's app may take to answer, and how it is tried: a TCP connect
   * to 127.0.0.1 for up to 120 s unless a test gives its own.
   */
  readonly hostedServiceReadiness?: HostedServiceReadinessOptions;
  /**
   * The folder The Office device helper's build is in (`tools/device-helper/dist` of the folder The
   * Office runs from), which `DeviceHelperFiles` copies; none for a test app, which has no helper.
   */
  readonly deviceHelperSource?: string;
}

@Module({})
export class RunEnvironmentsModule {
  static register({
    imports,
    knownTasks,
    containerRuntime,
    hostCores = availableParallelism(),
    serviceOwner = currentOperatingSystem().fileOwner,
    hostedServiceReadiness,
    deviceHelperSource,
  }: RunEnvironmentsModuleOptions): DynamicModule {
    return {
      module: RunEnvironmentsModule,
      imports: [...imports, ScheduleModule, BusyWorkModule],
      controllers: [ProjectRunEnvironmentsController, RunEnvironmentOfficeLimitsController],
      providers: [
        containerRuntime === undefined
          ? { provide: ContainerRuntime, useClass: ComposeCommandLine }
          : { provide: ContainerRuntime, useValue: containerRuntime },
        { provide: RunEnvironmentSettings, useClass: PostgresRunEnvironmentSettings },
        { provide: HostCores, useValue: new HostCores(hostCores) },
        { provide: ServiceOwner, useValue: serviceOwnerOf(serviceOwner) },
        { provide: KnownTasks, useExisting: knownTasks },
        {
          provide: HostedServiceReadiness,
          useValue: new HostedServiceReadiness(hostedServiceReadiness),
        },
        { provide: DeviceHelperSource, useValue: new DeviceHelperSource(deviceHelperSource) },
        DeviceHelperFiles,
        HostedServices,
        RunEnvironmentCommandVariables,
        RunEnvironmentFolders,
        RunEnvironmentImages,
        RunEnvironmentSlots,
        RunEnvironments,
        RunEnvironmentDefinitions,
        RunEnvironmentOfficeLimits,
        RunEnvironmentWebEvents,
        { provide: ProjectSettings, useClass: ProjectsSettings },
        { provide: RepositoryFiles, useClass: ProjectsRepositoryFiles },
        { provide: SetUpTasks, useClass: WorkSetUpTasks },
        ProjectRunEnvironments,
        ProjectsSetUpRegistration,
        ProjectsDevcontainerServicesRegistration,
        ProjectsTaskRunEnvironments,
      ],
      exports: [
        RunEnvironments,
        RunEnvironmentDefinitions,
        HostedServices,
        RunEnvironmentCommandVariables,
        DeviceHelperFiles,
        ProjectRunEnvironments,
      ],
    };
  }
}
