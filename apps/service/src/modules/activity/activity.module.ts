import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ActivityController } from "./adapters/http/activity.controller.js";
import { PostgresActivitySeenRepository } from "./adapters/postgres/postgres-activity-seen-repository.js";
import { ActivityWebEvents } from "./adapters/websocket/activity-web-events.js";
import { ActivityService } from "./application/activity-service.js";
import { ActivityCiRuns } from "./ports/activity-ci-runs.js";
import { ActivityDecisions } from "./ports/activity-decisions.js";
import { ActivityDevices } from "./ports/activity-devices.js";
import { ActivityEnvironmentChecks } from "./ports/activity-environment-checks.js";
import { ActivityOnboardings } from "./ports/activity-onboardings.js";
import { ActivityPullRequests } from "./ports/activity-pull-requests.js";
import { ActivitySeenRepository } from "./ports/activity-seen-repository.js";
import { ActivityStages } from "./ports/activity-stages.js";
import { ActivityTasks } from "./ports/activity-tasks.js";
import { ActivityTestInstances } from "./ports/activity-test-instances.js";

export interface ActivityModuleOptions {
  /** The modules that provide the ports below: Work, Pipelines, Conversations, Test instances, Projects and Devices. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly tasks: Type<ActivityTasks>;
  readonly stages: Type<ActivityStages>;
  readonly decisions: Type<ActivityDecisions>;
  readonly onboardings: Type<ActivityOnboardings>;
  readonly testInstances: Type<ActivityTestInstances>;
  readonly ciRuns: Type<ActivityCiRuns>;
  readonly environmentChecks: Type<ActivityEnvironmentChecks>;
  readonly pullRequests: Type<ActivityPullRequests>;
  readonly devices: Type<ActivityDevices>;
}

/**
 * Activity (spec §2.14): everything The Office is running, read through ports the composition root
 * binds to each owning module's application services, with what each user has seen kept in its one
 * table. No module calls it.
 */
@Module({})
export class ActivityModule {
  static register({
    imports,
    tasks,
    stages,
    decisions,
    onboardings,
    testInstances,
    ciRuns,
    environmentChecks,
    pullRequests,
    devices,
  }: ActivityModuleOptions): DynamicModule {
    return {
      module: ActivityModule,
      imports: [ScheduleModule, ...imports],
      controllers: [ActivityController],
      providers: [
        { provide: ActivityTasks, useExisting: tasks },
        { provide: ActivityStages, useExisting: stages },
        { provide: ActivityDecisions, useExisting: decisions },
        { provide: ActivityOnboardings, useExisting: onboardings },
        { provide: ActivityTestInstances, useExisting: testInstances },
        { provide: ActivityCiRuns, useExisting: ciRuns },
        { provide: ActivityEnvironmentChecks, useExisting: environmentChecks },
        { provide: ActivityPullRequests, useExisting: pullRequests },
        { provide: ActivityDevices, useExisting: devices },
        { provide: ActivitySeenRepository, useClass: PostgresActivitySeenRepository },
        ActivityService,
        ActivityWebEvents,
      ],
    };
  }
}
