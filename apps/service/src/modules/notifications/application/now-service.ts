import { isDeepStrictEqual } from "node:util";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { DomainEventClass } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DecisionReopened,
  TokensCounted,
  TurnEnded,
} from "../../conversations/index.js";
import { UsageWindowsChanged } from "../../engine/index.js";
import { DutyHolderChanged, RoleHired, RoleHiredBack, RoleLetGo } from "../../people/index.js";
import {
  DefinitionOfDoneNotMet,
  GateContinued,
  GateDropped,
  GateReached,
  NoRetriesLeft,
  SentBackFromGate,
  StageRunEnded,
  StageRunStarted,
  TaskStagesEdited,
} from "../../pipelines/index.js";
import {
  AlarmSounded,
  AllClearGiven,
  InitiativeCreated,
  InitiativeStateChanged,
  OfficeWideLimitChanged,
  TaskAddedToInitiative,
  TaskCreated,
  TaskLeftQueue,
  TaskMovedUpInQueue,
  TaskPaused,
  TaskQueued,
  TaskQueueReasonsChanged,
  TaskResumed,
  TaskStarted,
  TaskStateChanged,
  TaskStopped,
  TaskMovedToProject,
  TaskTakenOutOfInitiative,
} from "../../work/index.js";
import {
  nowOf,
  sinceYouLeftOf,
  type Now,
  type SinceYouLeft,
  type StartedTask,
  type TaskResume,
} from "../domain/now.js";
import { NowChanged } from "../domain/now-events.js";
import { addTokenKinds, officeDayOf } from "../domain/office-day.js";
import type { TaskOutcomeKind } from "../domain/task-outcome.js";
import { recordActivity, type UserActivity } from "../domain/user-activity.js";
import { AccountUsage } from "../ports/account-usage.js";
import { DeskLimit } from "../ports/desk-limit.js";
import { KnownPeople } from "../ports/known-people.js";
import { OfficeDayFigures } from "../ports/office-day-figures.js";
import { OfficeFireAlarm } from "../ports/office-fire-alarm.js";
import { OfficeInitiatives } from "../ports/office-initiatives.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { OpenDecisions } from "../ports/open-decisions.js";
import { ResumePlans } from "../ports/resume-plans.js";
import { StartQueue } from "../ports/start-queue.js";
import { TaskOutcomeRepository } from "../ports/task-outcome-repository.js";
import { TaskStageProgress } from "../ports/task-stage-progress.js";
import { UserActivityRepository } from "../ports/user-activity-repository.js";

/** The duty whose holder shapes each Initiative, by People's key. */
const SHAPES_INITIATIVES = "shapes-initiatives";

/** Events that change what Now shows without anything for Now to keep. */
const NOW_CHANGES: readonly DomainEventClass[] = [
  TaskStarted,
  TaskResumed,
  StageRunStarted,
  StageRunEnded,
  GateReached,
  GateContinued,
  SentBackFromGate,
  GateDropped,
  TaskStagesEdited,
  DecisionOpened,
  DecisionAnswered,
  DecisionClosed,
  DecisionReopened,
  UsageWindowsChanged,
  OfficeWideLimitChanged,
  TaskQueued,
  TaskQueueReasonsChanged,
  TaskLeftQueue,
  TaskMovedUpInQueue,
  AlarmSounded,
  AllClearGiven,
  // Shaping: an Initiative made (shaped from an Idea or created), confirmed or dropped, its Tasks
  // so far and their Projects, and who holds Shapes Initiatives.
  InitiativeCreated,
  InitiativeStateChanged,
  TaskCreated,
  TaskAddedToInitiative,
  TaskTakenOutOfInitiative,
  TaskMovedToProject,
  DutyHolderChanged,
  RoleHired,
  RoleHiredBack,
  RoleLetGo,
];

/**
 * Now and the status strip, read from the modules that own each part and kept fresh from their
 * domain events (spec §5.3): what only events tell, the outcomes, the day's figures and each user's
 * activity, is kept here. Each change is announced as `NowChanged` once the reads settle. Now is
 * shared; Since you left is each user's own (`sinceYouLeft`), read again on each `NowChanged`, which
 * is announced as well on a new outcome and when a user's Since you left moves.
 */
@Injectable()
export class NowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NowService.name);
  private announcing: Promise<void> | undefined;
  private announceAgain = false;
  /** Announces the next read even when Now is as announced: Since you left changed. */
  private announceAnyway = false;
  private announced: Now | undefined;

  constructor(
    private readonly tasks: OfficeTasks,
    private readonly initiatives: OfficeInitiatives,
    private readonly people: KnownPeople,
    private readonly decisions: OpenDecisions,
    private readonly stages: TaskStageProgress,
    private readonly deskLimit: DeskLimit,
    private readonly queue: StartQueue,
    private readonly usage: AccountUsage,
    private readonly outcomes: TaskOutcomeRepository,
    private readonly activity: UserActivityRepository,
    private readonly figures: OfficeDayFigures,
    private readonly fireAlarm: OfficeFireAlarm,
    private readonly resumePlans: ResumePlans,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    for (const eventClass of NOW_CHANGES) {
      this.events.subscribe(eventClass, () => this.announceInBackground());
    }
    this.subscribeToOutcomes();
    this.subscribeToFigures();
  }

  async onModuleDestroy(): Promise<void> {
    await this.announcing;
  }

  async now(): Promise<Now> {
    const at = new Date();
    const day = officeDayOf(at);
    const [
      started,
      openDecisions,
      queued,
      tasks,
      tokensToday,
      officeWideLimit,
      fireAlarm,
      initiatives,
      initiativeTasks,
      shaper,
    ] = await Promise.all([
      this.startedTasks(),
      this.decisions.listOpen(),
      this.queue.list(),
      this.tasks.list(),
      this.figures.tokensOn(day),
      this.deskLimit.officeWideLimit(),
      this.fireAlarm.read(),
      this.initiatives.list(),
      this.initiatives.tasksByInitiative(),
      this.people.holderOf(SHAPES_INITIATIVES),
    ]);
    return nowOf({
      started,
      openDecisions,
      queued,
      tasks,
      initiatives,
      initiativeTasks,
      shaper,
      tokensToday,
      officeWideLimit,
      usageWindows: [...this.usage.readingsByEngine].map(([engineId, { fiveHour, sevenDay }]) => ({
        engineId,
        fiveHour,
        sevenDay,
      })),
      fireAlarm,
      resumes: fireAlarm.on ? await this.resumesOf(started) : new Map(),
    });
  }

  /**
   * How each Task the alarm paused would resume, read afresh each time: a cache cools with no
   * event to tell.
   */
  private async resumesOf(
    started: readonly StartedTask[],
  ): Promise<ReadonlyMap<string, TaskResume | undefined>> {
    const paused = started.filter(({ task }) => task.pausedBy === "alarm");
    return new Map(
      await Promise.all(
        paused.map(async ({ task }) => [task.id, await this.resumePlans.of(task.id)] as const),
      ),
    );
  }

  /** The user's Since you left: from the start of their own last absence, with the outcomes since. */
  async sinceYouLeft(userId: string): Promise<SinceYouLeft> {
    const activity = await this.activity.find(userId);
    if (!activity) return sinceYouLeftOf(undefined, [], []);
    const [outcomes, tasks] = await Promise.all([
      this.outcomes.since(activity.leftAt),
      this.tasks.list(),
    ]);
    return sinceYouLeftOf(activity.leftAt, outcomes, tasks);
  }

  /**
   * The user was active just now; their coming back after an absence moves where their Since you
   * left begins, which `NowChanged` tells every web to read again.
   */
  async recordActivity(userId: string): Promise<UserActivity> {
    const { before, after } = await this.activity.update(userId, (known) =>
      recordActivity(known, this.schedule.now()),
    );
    if (before?.leftAt.getTime() !== after.leftAt.getTime()) this.announceInBackground(true);
    return after;
  }

  private subscribeToOutcomes(): void {
    this.events.subscribe(TaskStateChanged, ({ taskId, to, occurredAt }) =>
      to === "done" ? this.keepOutcome(taskId, "done", occurredAt) : this.announceInBackground(),
    );
    // What the fire alarm or an Initiative's Pause holds is no Outcome: Now shows it with the
    // alarm, and the Initiative that it is paused. A refusal for a used-up usage window is.
    this.events.subscribe(TaskPaused, ({ taskId, occurredAt, by, from, usageWindow }) =>
      by === "user" || (by === "usage-window" && usageWindow !== undefined && from !== "paused")
        ? this.keepOutcome(taskId, "paused", occurredAt)
        : this.announceInBackground(),
    );
    this.events.subscribe(TaskStopped, ({ taskId, occurredAt }) =>
      this.keepOutcome(taskId, "paused", occurredAt),
    );
    // A failure put to a Consultant first isn't the user's outcome unless they pass it on.
    this.events.subscribe(NoRetriesLeft, ({ taskId, occurredAt, putTo }) =>
      putTo === undefined ? this.keepOutcome(taskId, "failed", occurredAt) : undefined,
    );
    this.events.subscribe(DefinitionOfDoneNotMet, ({ taskId, occurredAt }) =>
      this.keepOutcome(taskId, "failed", occurredAt),
    );
  }

  private subscribeToFigures(): void {
    for (const eventClass of [TokensCounted, TurnEnded]) {
      this.events.subscribe(eventClass, async ({ thread, occurredAt }) => {
        await this.figures.countThreadTokens(
          thread.id,
          {
            endedTurns: thread.tokens,
            soFar: addTokenKinds(thread.tokens, thread.runningTurnTokens),
          },
          officeDayOf(occurredAt),
        );
        this.announceInBackground();
      });
    }
  }

  private async keepOutcome(
    taskId: string,
    outcome: TaskOutcomeKind,
    occurredAt: Date,
  ): Promise<void> {
    await this.outcomes.add({ taskId, outcome, occurredAt });
    this.announceInBackground(true);
  }

  private async startedTasks(): Promise<StartedTask[]> {
    const started = await this.tasks.listStarted();
    return Promise.all(
      started.map(async (task) => ({
        task,
        stages: (await this.stages.progress(task.id))?.stages,
      })),
    );
  }

  /**
   * Reads Now and announces it when it differs from what was last announced, returning at once
   * (`EventBus.publish` waits for its handlers). A burst of events while a read goes on makes one
   * more read after it, not one each. `anyway` announces it even when Now is unchanged, for Since
   * you left, which each web reads again on it.
   */
  private announceInBackground(anyway = false): void {
    if (anyway) this.announceAnyway = true;
    if (this.announcing) {
      this.announceAgain = true;
      return;
    }
    this.announcing = this.announceUntilSettled()
      .catch((error: unknown) => {
        this.logger.error("Now could not be read", stackOf(error));
      })
      .finally(() => {
        this.announcing = undefined;
      });
  }

  private async announceUntilSettled(): Promise<void> {
    do {
      this.announceAgain = false;
      const anyway = this.announceAnyway;
      this.announceAnyway = false;
      const now = await this.now();
      if (!anyway && isDeepStrictEqual(now, this.announced)) continue;
      this.announced = now;
      await this.events.publish(new NowChanged(now));
    } while (this.announceAgain);
  }
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
