import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ActivityController } from "./adapters/http/activity.controller.js";
import { ActivityWebEvents } from "./adapters/websocket/activity-web-events.js";
import { ActivityService } from "./application/activity-service.js";
import { ActivityCiRuns } from "./ports/activity-ci-runs.js";
import { ActivityDecisions } from "./ports/activity-decisions.js";
import { ActivityDevices } from "./ports/activity-devices.js";
import { ActivityEnvironmentChecks } from "./ports/activity-environment-checks.js";
import { ActivityOffBoardTasks } from "./ports/activity-off-board-tasks.js";
import { ActivityInitiatives } from "./ports/activity-initiatives.js";
import { ActivitySessions } from "./ports/activity-sessions.js";
import { ActivityStages } from "./ports/activity-stages.js";
import { ActivityTasks } from "./ports/activity-tasks.js";
import { ActivityTestInstances } from "./ports/activity-test-instances.js";
import { ActivityActionRuns } from "./ports/activity-action-runs.js";

export interface ActivityModuleOptions {
  /**
   * The modules that provide the ports below: Work, Pipelines, Conversations, Test instances,
   * Actions, Projects and Devices.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly tasks: Type<ActivityTasks>;
  readonly initiatives: Type<ActivityInitiatives>;
  readonly sessions: Type<ActivitySessions>;
  readonly stages: Type<ActivityStages>;
  readonly decisions: Type<ActivityDecisions>;
  readonly offBoardTasks: Type<ActivityOffBoardTasks>;
  readonly testInstances: Type<ActivityTestInstances>;
  readonly actionRuns: Type<ActivityActionRuns>;
  readonly ciRuns: Type<ActivityCiRuns>;
  readonly environmentChecks: Type<ActivityEnvironmentChecks>;
  readonly devices: Type<ActivityDevices>;
}

/**
 * Activity (spec §2.14): the active sessions and the other running work, read through ports the
 * composition root binds to each owning module's application services. It keeps nothing. No module
 * calls it.
 */
@Module({})
export class ActivityModule {
  static register({
    imports,
    tasks,
    initiatives,
    sessions,
    stages,
    decisions,
    offBoardTasks,
    testInstances,
    actionRuns,
    ciRuns,
    environmentChecks,
    devices,
  }: ActivityModuleOptions): DynamicModule {
    return {
      module: ActivityModule,
      imports: [ScheduleModule, ...imports],
      controllers: [ActivityController],
      providers: [
        { provide: ActivityTasks, useExisting: tasks },
        { provide: ActivityInitiatives, useExisting: initiatives },
        { provide: ActivitySessions, useExisting: sessions },
        { provide: ActivityStages, useExisting: stages },
        { provide: ActivityDecisions, useExisting: decisions },
        { provide: ActivityOffBoardTasks, useExisting: offBoardTasks },
        { provide: ActivityTestInstances, useExisting: testInstances },
        { provide: ActivityActionRuns, useExisting: actionRuns },
        { provide: ActivityCiRuns, useExisting: ciRuns },
        { provide: ActivityEnvironmentChecks, useExisting: environmentChecks },
        { provide: ActivityDevices, useExisting: devices },
        ActivityService,
        ActivityWebEvents,
      ],
    };
  }
}
