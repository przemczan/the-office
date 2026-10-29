import { isDeepStrictEqual } from "node:util";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { DomainEventClass } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  DecisionAnswered,
  DecisionOpened,
  DecisionReopened,
  TokensCounted,
  TurnEnded,
} from "../../conversations/index.js";
import { UsageWindowsChanged } from "../../engine/index.js";
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
  OfficeWideLimitChanged,
  TaskLeftQueue,
  TaskMovedUpInQueue,
  TaskPaused,
  TaskQueued,
  TaskResumed,
  TaskStarted,
  TaskStateChanged,
  TaskStopped,
} from "../../work/index.js";
import { nowOf, type Now, type StartedTask, type TaskResume } from "../domain/now.js";
import { NowChanged } from "../domain/now-events.js";
import { officeDayOf } from "../domain/office-day.js";
import type { TaskOutcomeKind } from "../domain/task-outcome.js";
import { recordActivity, type UserActivity } from "../domain/user-activity.js";
import { AccountUsage } from "../ports/account-usage.js";
import { DeskLimit } from "../ports/desk-limit.js";
import { OfficeDayFigures } from "../ports/office-day-figures.js";
import { OfficeFireAlarm } from "../ports/office-fire-alarm.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { OpenDecisions } from "../ports/open-decisions.js";
import { ResumePlans } from "../ports/resume-plans.js";
import { StartQueue } from "../ports/start-queue.js";
import { TaskOutcomeRepository } from "../ports/task-outcome-repository.js";
import { TaskStageProgress } from "../ports/task-stage-progress.js";
import { UserActivityRepository } from "../ports/user-activity-repository.js";

/** Events that change what Now shows without anything for Now to keep. */
const NOW_CHANGES: readonly DomainEventClass[] = [
  TaskStarted,
  TaskResumed,
  StageRunEnded,
  GateReached,
  GateContinued,
  SentBackFromGate,
  GateDropped,
  TaskStagesEdited,
  DecisionOpened,
  DecisionAnswered,
  DecisionReopened,
  UsageWindowsChanged,
  OfficeWideLimitChanged,
  TaskQueued,
  TaskLeftQueue,
  TaskMovedUpInQueue,
  AlarmSounded,
  AllClearGiven,
];

/**
 * Now and the status strip, read from the modules that own each part and kept fresh from their
 * domain events (spec §5.3): what only events tell, the outcomes, the day's figures and the user's
 * activity, is kept here. Each change is announced as `NowChanged` once the reads settle.
 */
@Injectable()
export class NowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NowService.name);
  private announcing: Promise<void> | undefined;
  private announceAgain = false;
  private announced: Now | undefined;

  constructor(
    private readonly tasks: OfficeTasks,
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
      activity,
      tokensToday,
      tasksTouched,
      officeWideLimit,
      fireAlarm,
    ] = await Promise.all([
      this.startedTasks(),
      this.decisions.listOpen(),
      this.queue.list(),
      this.tasks.list(),
      this.activity.find(),
      this.figures.tokensOn(day),
      this.figures.tasksTouchedOn(day),
      this.deskLimit.officeWideLimit(),
      this.fireAlarm.read(),
    ]);
    return nowOf({
      started,
      openDecisions,
      queued,
      tasks,
      leftAt: activity?.leftAt,
      outcomes: activity ? await this.outcomes.since(activity.leftAt) : [],
      tokensToday,
      tasksTouched,
      officeWideLimit,
      fiveHourWindow: this.usage.current?.fiveHour,
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
    const paused = started.filter(({ task }) => task.pausedByAlarm);
    return new Map(
      await Promise.all(
        paused.map(async ({ task }) => [task.id, await this.resumePlans.of(task.id)] as const),
      ),
    );
  }

  /** The user was active just now; coming back after an absence moves where Since you left begins. */
  async recordActivity(): Promise<UserActivity> {
    const recorded = await this.activity.update((known) =>
      recordActivity(known, this.schedule.now()),
    );
    if (this.announced?.leftAt?.getTime() !== recorded.leftAt.getTime()) {
      this.announceInBackground();
    }
    return recorded;
  }

  private subscribeToOutcomes(): void {
    this.events.subscribe(TaskStateChanged, ({ taskId, to, occurredAt }) =>
      to === "done" ? this.keepOutcome(taskId, "done", occurredAt) : this.announceInBackground(),
    );
    // What the fire alarm holds is no Outcome: Now shows it with the alarm.
    this.events.subscribe(TaskPaused, ({ taskId, occurredAt, by }) =>
      by === "alarm" ? this.announceInBackground() : this.keepOutcome(taskId, "paused", occurredAt),
    );
    this.events.subscribe(TaskStopped, ({ taskId, occurredAt }) =>
      this.keepOutcome(taskId, "paused", occurredAt),
    );
    // A failure put to the CTO first isn't the user's outcome unless the CTO passes it on.
    this.events.subscribe(NoRetriesLeft, ({ taskId, occurredAt, putTo }) =>
      putTo === undefined ? this.keepOutcome(taskId, "failed", occurredAt) : undefined,
    );
    this.events.subscribe(DefinitionOfDoneNotMet, ({ taskId, occurredAt }) =>
      this.keepOutcome(taskId, "failed", occurredAt),
    );
  }

  private subscribeToFigures(): void {
    this.events.subscribe(StageRunStarted, async ({ taskId, occurredAt }) => {
      await this.figures.touchTask(taskId, officeDayOf(occurredAt));
      this.announceInBackground();
    });
    for (const eventClass of [TokensCounted, TurnEnded]) {
      this.events.subscribe(eventClass, async ({ thread, occurredAt }) => {
        const endedTurns = allKinds(thread.tokens);
        await this.figures.countThreadTokens(
          thread.id,
          { endedTurns, soFar: endedTurns + allKinds(thread.runningTurnTokens) },
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
    this.announceInBackground();
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
   * more read after it, not one each.
   */
  private announceInBackground(): void {
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
      const now = await this.now();
      if (isDeepStrictEqual(now, this.announced)) continue;
      this.announced = now;
      await this.events.publish(new NowChanged(now));
    } while (this.announceAgain);
  }
}

function allKinds({
  input,
  output,
  cacheRead,
  cacheCreation,
}: {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}): number {
  return input + output + cacheRead + cacheCreation;
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
