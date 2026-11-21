import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { NotificationsController } from "./adapters/http/notifications.controller.js";
import { NowController } from "./adapters/http/now.controller.js";
import { PostgresNotificationRepository } from "./adapters/postgres/postgres-notification-repository.js";
import { PostgresNotificationRoutingRepository } from "./adapters/postgres/postgres-notification-routing-repository.js";
import { PostgresNotificationTimingRepository } from "./adapters/postgres/postgres-notification-timing-repository.js";
import { PostgresOfficeDayFigures } from "./adapters/postgres/postgres-office-day-figures.js";
import { PostgresTaskOutcomeRepository } from "./adapters/postgres/postgres-task-outcome-repository.js";
import { PostgresUserActivityRepository } from "./adapters/postgres/postgres-user-activity-repository.js";
import { OfficeStatusOfficeTools } from "./adapters/office-tools/office-status-office-tools.js";
import { RecordingPhonePush } from "./adapters/phone/recording-phone-push.js";
import { NotificationsWebEvents } from "./adapters/websocket/notifications-web-events.js";
import { DayTokenHistory } from "./application/day-token-history.js";
import { NotificationDelivery } from "./application/notification-delivery.js";
import { NotificationRouting } from "./application/notification-routing.js";
import { NotificationService } from "./application/notification-service.js";
import { NowService } from "./application/now-service.js";
import { AccountUsage } from "./ports/account-usage.js";
import { DeskLimit } from "./ports/desk-limit.js";
import { StartQueue } from "./ports/start-queue.js";
import { KnownPeople } from "./ports/known-people.js";
import { NotificationRepository } from "./ports/notification-repository.js";
import { NotificationRoutingRepository } from "./ports/notification-routing-repository.js";
import { NotificationTimingRepository } from "./ports/notification-timing-repository.js";
import { OfficeDayFigures } from "./ports/office-day-figures.js";
import { OfficeStatusCards } from "./ports/office-status-cards.js";
import { OfficeFireAlarm } from "./ports/office-fire-alarm.js";
import { OfficeInitiatives } from "./ports/office-initiatives.js";
import { OfficeTasks } from "./ports/office-tasks.js";
import { OfficeUpdateAvailable } from "./ports/office-update-available.js";
import { OpenDecisions } from "./ports/open-decisions.js";
import { OpenProposals } from "./ports/open-proposals.js";
import { PullRequestsWaiting } from "./ports/pull-requests-waiting.js";
import { PhonePush } from "./ports/phone-push.js";
import { ResumePlans } from "./ports/resume-plans.js";
import { ShapingReplies } from "./ports/shaping-replies.js";
import { SkillUpdatesFound } from "./ports/skill-updates-found.js";
import { StandInChoicesWaiting } from "./ports/stand-in-choices-waiting.js";
import { TaskOutcomeRepository } from "./ports/task-outcome-repository.js";
import { TaskStageProgress } from "./ports/task-stage-progress.js";
import { UserActivityRepository } from "./ports/user-activity-repository.js";

export interface NotificationsModuleOptions {
  /**
   * The modules that provide the ports below: Work, Conversations, Pipelines, People, Projects,
   * Skills, Office-updates and the Engine, whose Office tool registry takes the Office Manager's
   * Office status.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly officeTasks: Type<OfficeTasks>;
  readonly officeInitiatives: Type<OfficeInitiatives>;
  readonly openDecisions: Type<OpenDecisions>;
  readonly taskStageProgress: Type<TaskStageProgress>;
  readonly deskLimit: Type<DeskLimit>;
  readonly startQueue: Type<StartQueue>;
  readonly knownPeople: Type<KnownPeople>;
  readonly accountUsage: Type<AccountUsage>;
  readonly officeStatusCards: Type<OfficeStatusCards>;
  readonly officeFireAlarm: Type<OfficeFireAlarm>;
  readonly resumePlans: Type<ResumePlans>;
  readonly standInChoicesWaiting: Type<StandInChoicesWaiting>;
  readonly openProposals: Type<OpenProposals>;
  readonly pullRequestsWaiting: Type<PullRequestsWaiting>;
  readonly skillUpdatesFound: Type<SkillUpdatesFound>;
  readonly officeUpdateAvailable: Type<OfficeUpdateAvailable>;
  readonly shapingReplies: Type<ShapingReplies>;
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
    officeInitiatives,
    openDecisions,
    taskStageProgress,
    deskLimit,
    startQueue,
    knownPeople,
    accountUsage,
    officeStatusCards,
    officeFireAlarm,
    resumePlans,
    standInChoicesWaiting,
    openProposals,
    pullRequestsWaiting,
    skillUpdatesFound,
    officeUpdateAvailable,
    shapingReplies,
  }: NotificationsModuleOptions): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [ScheduleModule, ...imports],
      controllers: [NowController, NotificationsController],
      providers: [
        { provide: TaskOutcomeRepository, useClass: PostgresTaskOutcomeRepository },
        { provide: UserActivityRepository, useClass: PostgresUserActivityRepository },
        { provide: OfficeDayFigures, useClass: PostgresOfficeDayFigures },
        { provide: NotificationRepository, useClass: PostgresNotificationRepository },
        { provide: NotificationRoutingRepository, useClass: PostgresNotificationRoutingRepository },
        { provide: NotificationTimingRepository, useClass: PostgresNotificationTimingRepository },
        // Task 28 binds Web Push here.
        { provide: PhonePush, useClass: RecordingPhonePush },
        { provide: OfficeTasks, useExisting: officeTasks },
        { provide: OfficeInitiatives, useExisting: officeInitiatives },
        { provide: OpenDecisions, useExisting: openDecisions },
        { provide: TaskStageProgress, useExisting: taskStageProgress },
        { provide: DeskLimit, useExisting: deskLimit },
        { provide: StartQueue, useExisting: startQueue },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: AccountUsage, useExisting: accountUsage },
        { provide: OfficeStatusCards, useExisting: officeStatusCards },
        { provide: OfficeFireAlarm, useExisting: officeFireAlarm },
        { provide: ResumePlans, useExisting: resumePlans },
        { provide: StandInChoicesWaiting, useExisting: standInChoicesWaiting },
        { provide: OpenProposals, useExisting: openProposals },
        { provide: PullRequestsWaiting, useExisting: pullRequestsWaiting },
        { provide: SkillUpdatesFound, useExisting: skillUpdatesFound },
        { provide: OfficeUpdateAvailable, useExisting: officeUpdateAvailable },
        { provide: ShapingReplies, useExisting: shapingReplies },
        NowService,
        NotificationService,
        NotificationDelivery,
        NotificationRouting,
        NotificationsWebEvents,
        OfficeStatusOfficeTools,
        DayTokenHistory,
      ],
      exports: [DayTokenHistory],
    };
  }
}
