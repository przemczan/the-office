import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { ComposeCommandLine } from "./adapters/compose/compose-command-line.js";
import { PostgresRunEnvironmentSettings } from "./adapters/postgres/postgres-run-environment-settings.js";
import { RunEnvironmentFolders } from "./application/run-environment-folders.js";
import { RunEnvironmentImages } from "./application/run-environment-images.js";
import { RunEnvironmentSlots } from "./application/run-environment-slots.js";
import { RunEnvironments } from "./application/run-environments.js";
import { ContainerRuntime } from "./ports/container-runtime.js";
import { KnownTasks } from "./ports/known-tasks.js";
import { RunEnvironmentSettings } from "./ports/run-environment-settings.js";

export interface RunEnvironmentsModuleOptions {
  /** The modules that provide `knownTasks`. */
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
      ],
      exports: [RunEnvironments],
    };
  }
}
