import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { NotificationsController } from "./adapters/http/notifications.controller.js";
import { NowController } from "./adapters/http/now.controller.js";
import { PostgresNotificationRepository } from "./adapters/postgres/postgres-notification-repository.js";
import { PostgresOfficeDayFigures } from "./adapters/postgres/postgres-office-day-figures.js";
import { PostgresTaskOutcomeRepository } from "./adapters/postgres/postgres-task-outcome-repository.js";
import { PostgresUserActivityRepository } from "./adapters/postgres/postgres-user-activity-repository.js";
import { OfficeStatusOfficeTools } from "./adapters/office-tools/office-status-office-tools.js";
import { NotificationsWebEvents } from "./adapters/websocket/notifications-web-events.js";
import { NotificationService } from "./application/notification-service.js";
import { NowService } from "./application/now-service.js";
import { AccountUsage } from "./ports/account-usage.js";
import { DeskLimit } from "./ports/desk-limit.js";
import { NotificationRepository } from "./ports/notification-repository.js";
import { OfficeDayFigures } from "./ports/office-day-figures.js";
import { OfficeStatusCards } from "./ports/office-status-cards.js";
import { OfficeTasks } from "./ports/office-tasks.js";
import { OpenDecisions } from "./ports/open-decisions.js";
import { TaskOutcomeRepository } from "./ports/task-outcome-repository.js";
import { TaskStageProgress } from "./ports/task-stage-progress.js";
import { UserActivityRepository } from "./ports/user-activity-repository.js";

export interface NotificationsModuleOptions {
  /**
   * The modules that provide the ports below: Work, Conversations, Pipelines and the Engine, whose
   * Office tool registry takes the Office Manager's Office status.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly officeTasks: Type<OfficeTasks>;
  readonly openDecisions: Type<OpenDecisions>;
  readonly taskStageProgress: Type<TaskStageProgress>;
  readonly deskLimit: Type<DeskLimit>;
  readonly accountUsage: Type<AccountUsage>;
  readonly officeStatusCards: Type<OfficeStatusCards>;
}

/**
 * Now, the status strip and Notifications: what waits on the user and what happened, read from the
 * modules that own it. Nothing calls it; it listens to their events, and the Office Manager reads
 * the Office status from Now through an Office tool.
 */
@Module({})
export class NotificationsModule {
  static register({
    imports,
    officeTasks,
    openDecisions,
    taskStageProgress,
    deskLimit,
    accountUsage,
    officeStatusCards,
  }: NotificationsModuleOptions): DynamicModule {
    return {
      module: NotificationsModule,
      imports,
      controllers: [NowController, NotificationsController],
      providers: [
        { provide: TaskOutcomeRepository, useClass: PostgresTaskOutcomeRepository },
        { provide: UserActivityRepository, useClass: PostgresUserActivityRepository },
        { provide: OfficeDayFigures, useClass: PostgresOfficeDayFigures },
        { provide: NotificationRepository, useClass: PostgresNotificationRepository },
        { provide: OfficeTasks, useExisting: officeTasks },
        { provide: OpenDecisions, useExisting: openDecisions },
        { provide: TaskStageProgress, useExisting: taskStageProgress },
        { provide: DeskLimit, useExisting: deskLimit },
        { provide: AccountUsage, useExisting: accountUsage },
        { provide: OfficeStatusCards, useExisting: officeStatusCards },
        NowService,
        NotificationService,
        NotificationsWebEvents,
        OfficeStatusOfficeTools,
      ],
    };
  }
}
