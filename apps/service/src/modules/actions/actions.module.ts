import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../busy-work/index.js";
import { EngineModule } from "../engine/index.js";
import { ActionSettingsOfficeActionsController } from "./adapters/http/action-settings-office-actions.controller.js";
import { ActionSettingsOfficeActions } from "./adapters/office-actions/action-settings-office-actions.js";
import { DevicesActionDevices } from "./adapters/devices/devices-action-devices.js";
import { DomainEventSignals } from "./adapters/events/domain-event-signals.js";
import { ActionRunsController } from "./adapters/http/action-runs.controller.js";
import { ActionSettingsController } from "./adapters/http/action-settings.controller.js";
import { PostgresActionRunRepository } from "./adapters/postgres/postgres-action-run-repository.js";
import { PostgresActionSettings } from "./adapters/postgres/postgres-action-settings.js";
import { ActionLastRunsRegistration } from "./adapters/projects/action-last-runs-registration.js";
import { ProjectsActionProjects } from "./adapters/projects/projects-action-projects.js";
import { ProjectsWorkflowHost } from "./adapters/projects/projects-workflow-host.js";
import { RunEnvironmentsCommandRuns } from "./adapters/run-environments/run-environments-command-runs.js";
import { TestInstancesActionRuns } from "./adapters/test-instances/test-instances-action-runs.js";
import { ActionRunWebEvents } from "./adapters/websocket/action-run-web-events.js";
import { WorkActionSources } from "./adapters/work/work-action-sources.js";
import { ActionLimits } from "./application/action-limits.js";
import { ActionRunLogs } from "./application/action-run-logs.js";
import { ActionRunReactions } from "./application/action-run-reactions.js";
import { ActionRunRecords } from "./application/action-run-records.js";
import { ActionRuns } from "./application/action-runs.js";
import { CommandRuns } from "./application/command-runs.js";
import { RunsInBackground } from "./application/runs-in-background.js";
import { WorkflowRuns } from "./application/workflow-runs.js";
import { ActionDevices } from "./ports/action-devices.js";
import { ActionProjects } from "./ports/action-projects.js";
import { ActionRunRepository } from "./ports/action-run-repository.js";
import { ActionRunSignals } from "./ports/action-run-signals.js";
import { ActionSettingsStore } from "./ports/action-settings-store.js";
import { ActionSources } from "./ports/action-sources.js";
import { ActionTestInstances } from "./ports/action-test-instances.js";
import { ActionWorkflowHost } from "./ports/action-workflow-host.js";
import { CommandRunEnvironments } from "./ports/command-run-environments.js";

export interface ActionsModuleOptions {
  /**
   * Work, Projects, Run environments, Test instances and Devices: Work's `TaskService`,
   * `InitiativeService` and `FireAlarmService`; Projects' `ActionRunSettings`,
   * `ActionRunCheckouts`, `ActionWorkflows`, `ActionLastRuns` and `TestTargets`; Run environments'
   * `ActionRunEnvironments`; Test instances' `TestInstances`; Devices' `ProjectDevices` and
   * `ConnectedDevices`.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
}

@Module({})
export class ActionsModule {
  static register({ imports }: ActionsModuleOptions): DynamicModule {
    return {
      module: ActionsModule,
      imports: [...imports, BusyWorkModule, ScheduleModule, EngineModule],
      controllers: [
        ActionRunsController,
        ActionSettingsController,
        ActionSettingsOfficeActionsController,
      ],
      providers: [
        { provide: ActionRunRepository, useClass: PostgresActionRunRepository },
        { provide: ActionSettingsStore, useClass: PostgresActionSettings },
        { provide: ActionProjects, useClass: ProjectsActionProjects },
        { provide: ActionWorkflowHost, useClass: ProjectsWorkflowHost },
        { provide: CommandRunEnvironments, useClass: RunEnvironmentsCommandRuns },
        { provide: ActionTestInstances, useClass: TestInstancesActionRuns },
        { provide: ActionDevices, useClass: DevicesActionDevices },
        { provide: ActionSources, useClass: WorkActionSources },
        { provide: ActionRunSignals, useClass: DomainEventSignals },
        ActionLastRunsRegistration,
        ActionLimits,
        ActionSettingsOfficeActions,
        ActionRunLogs,
        ActionRunReactions,
        ActionRunRecords,
        ActionRuns,
        ActionRunWebEvents,
        CommandRuns,
        RunsInBackground,
        WorkflowRuns,
      ],
      exports: [ActionRuns, ActionLimits],
    };
  }
}
