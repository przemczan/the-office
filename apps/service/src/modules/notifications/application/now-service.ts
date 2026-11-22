import { isDeepStrictEqual } from "node:util";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { inReadScope } from "../../../platform/database/read-scope.js";
import type { DomainEventClass } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DecisionReopened,
  MessagesLogged,
  ProposalApplied,
  ProposalDeclined,
  ProposalDrafted,
  TokensCounted,
  TurnEnded,
} from "../../conversations/index.js";
import { UsageWindowsChanged } from "../../engine/index.js";
import {
  OfficeRestartScheduled,
  OfficeUpdateChecked,
  OfficeUpdateScheduled,
  ScheduledExitCancelled,
} from "../../office-updates/index.js";
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
  StandInChoicesChanged,
  TaskStagesEdited,
} from "../../pipelines/index.js";
import {
  PullRequestClosed,
  PullRequestMerged,
  PullRequestOpened,
  PullRequestReopened,
  PullRequestsChecked,
} from "../../projects/index.js";
import {
  SkillRemoved,
  SkillUpdated,
  SkillUpdateFound,
  SkillUpdateGone,
} from "../../skills/index.js";
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
import { OfficeUpdateAvailable } from "../ports/office-update-available.js";
import { OpenDecisions } from "../ports/open-decisions.js";
import { OpenProposals } from "../ports/open-proposals.js";
import { PullRequestsWaiting } from "../ports/pull-requests-waiting.js";
import { ResumePlans } from "../ports/resume-plans.js";
import { ShapingReplies } from "../ports/shaping-replies.js";
import { SkillUpdatesFound } from "../ports/skill-updates-found.js";
import { StandInChoicesWaiting } from "../ports/stand-in-choices-waiting.js";
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
  StandInChoicesChanged,
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
  // Waiting for you: Proposals, pull requests, Skill updates and the Office update. A shaper's
  // answer ends its turn, which `TurnEnded` announces; the user's reply is `MessagesLogged`'s.
  ProposalDrafted,
  ProposalApplied,
  ProposalDeclined,
  PullRequestOpened,
  PullRequestsChecked,
  PullRequestMerged,
  PullRequestClosed,
  PullRequestReopened,
  SkillUpdateFound,
  SkillUpdateGone,
  SkillUpdated,
  SkillRemoved,
  OfficeUpdateChecked,
  OfficeUpdateScheduled,
  OfficeRestartScheduled,
  ScheduledExitCancelled,
];

/** What an event can have changed of Now: all of it, or only today's tokens. */
type NowRead = "whole" | "tokens today";

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
  /** What the next read reads; undefined while no event asks for one. */
  private nextRead: NowRead | undefined;
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
    private readonly standInChoices: StandInChoicesWaiting,
    private readonly proposals: OpenProposals,
    private readonly pullRequests: PullRequestsWaiting,
    private readonly skillUpdates: SkillUpdatesFound,
    private readonly officeUpdate: OfficeUpdateAvailable,
    private readonly shapingReplies: ShapingReplies,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    for (const eventClass of NOW_CHANGES) {
      this.events.subscribe(eventClass, () => this.announceInBackground());
    }
    this.subscribeToOutcomes();
    this.subscribeToFigures();
    this.subscribeToShapingReplies();
  }

  async onModuleDestroy(): Promise<void> {
    await this.announcing;
  }

  async now(): Promise<Now> {
    const at = new Date();
    const day = officeDayOf(at);
    const waitingOnTasks = Promise.all([
      this.decisions.listOpen(),
      this.queue.list(),
      this.proposals.waitingOnTheUser(),
    ]);
    const initiativesNow = this.initiatives.list();
    const [
      started,
      [openDecisions, queued, openProposals],
      tasks,
      tokensToday,
      officeWideLimit,
      fireAlarm,
      initiatives,
      initiativeTasks,
      shaper,
      standInChoices,
      pullRequests,
      skillUpdates,
      officeUpdate,
      shapingReplies,
    ] = await Promise.all([
      this.startedTasks(),
      waitingOnTasks,
      waitingOnTasks.then(([decisions, queue, proposals]) =>
        this.tasks.findAll([
          ...new Set([
            ...decisions.flatMap(({ taskId }) => taskId ?? []),
            ...queue.map(({ taskId }) => taskId),
            ...proposals.flatMap(({ home }) => (home.kind === "task" ? home.taskId : [])),
          ]),
        ]),
      ),
      this.figures.tokensOn(day),
      this.deskLimit.officeWideLimit(),
      this.fireAlarm.read(),
      initiativesNow,
      this.initiatives.tasksByInitiative(),
      this.people.holderOf(SHAPES_INITIATIVES),
      this.standInChoices.waiting(),
      this.pullRequests.needingAttention(),
      this.skillUpdates.withUpdate(),
      this.officeUpdate.available(),
      initiativesNow.then((all) =>
        this.shapingReplies.waitingForReply(
          all.filter(({ state }) => state === "shaping").map(({ id }) => id),
        ),
      ),
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
      standInChoices,
      openProposals,
      pullRequests,
      skillUpdates,
      officeUpdate,
      shapingReplies,
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
      await readEach(
        paused,
        async ({ task }) => [task.id, await this.resumePlans.of(task.id)] as const,
      ),
    );
  }

  /** The user's Since you left: from the start of their own last absence, with the outcomes since. */
  async sinceYouLeft(userId: string): Promise<SinceYouLeft> {
    const activity = await this.activity.find(userId);
    if (!activity) return sinceYouLeftOf(undefined, [], []);
    const outcomes = await this.outcomes.since(activity.leftAt);
    const tasks = await this.tasks.findAll([...new Set(outcomes.map(({ taskId }) => taskId))]);
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
    // alarm, and the Initiative that it is paused. A refusal for a used-up usage window is, unless
    // its Stage waits for the user's choice of a Stand-in Engine, which Needs you shows instead.
    this.events.subscribe(TaskPaused, ({ taskId, occurredAt, by, from, usageWindow }) =>
      by === "user" ||
      (by === "usage-window" &&
        usageWindow !== undefined &&
        usageWindow.awaitsStandInChoice !== true &&
        from !== "paused")
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
      this.events.subscribe(eventClass, async (event) => {
        const { thread, occurredAt } = event;
        await this.figures.countThreadTokens(
          thread.id,
          {
            endedTurns: thread.tokens,
            soFar: addTokenKinds(thread.tokens, thread.runningTurnTokens),
          },
          officeDayOf(occurredAt),
        );
        // Tokens are counted many times a turn and change only the day's tokens; a turn's end may
        // change more.
        this.announceInBackground(false, event instanceof TokensCounted ? "tokens today" : "whole");
      });
    }
  }

  /**
   * The user's reply in an Initiative's Thread ends the shaper's wait on it; the shaper's own
   * answer is announced on its turn's end.
   */
  private subscribeToShapingReplies(): void {
    this.events.subscribe(MessagesLogged, ({ thread, messages }) => {
      if (thread.home.kind === "initiative" && messages.some(({ kind }) => kind === "user")) {
        this.announceInBackground();
      }
    });
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
    const started = await this.tasks.started();
    return readEach(started, async (task) => ({
      task,
      stages: (await this.stages.progress(task.id))?.stages,
    }));
  }

  /**
   * Reads Now and announces it when it differs from what was last announced, returning at once
   * (`EventBus.publish` waits for its handlers). A burst of events while a read goes on makes one
   * more read after it, not one each. `anyway` announces it even when Now is unchanged, for Since
   * you left, which each web reads again on it. `read` is what the event can have changed: the
   * whole of Now, or only today's tokens, which are read alone on what was last announced.
   */
  private announceInBackground(anyway = false, read: NowRead = "whole"): void {
    if (anyway) this.announceAnyway = true;
    this.nextRead = this.nextRead === "whole" ? "whole" : read;
    if (this.announcing) return;
    this.announcing = this.announceUntilSettled()
      .catch((error: unknown) => {
        this.logger.error("Now could not be read", stackOf(error));
      })
      .finally(() => {
        this.announcing = undefined;
        // An event that came as the last read ended still wants its read.
        if (this.nextRead !== undefined) this.announceInBackground(false, this.nextRead);
      });
  }

  private async announceUntilSettled(): Promise<void> {
    while (this.nextRead !== undefined) {
      const read = this.nextRead;
      this.nextRead = undefined;
      const anyway = this.announceAnyway;
      this.announceAnyway = false;
      const now =
        read === "tokens today" && this.announced
          ? await this.withTokensToday(this.announced)
          : // A scope of its own: what each started Task's Stages read in common is read once.
            await inReadScope(() => this.now());
      if (!anyway && isDeepStrictEqual(now, this.announced)) continue;
      this.announced = now;
      await this.events.publish(new NowChanged(now));
    }
  }

  private async withTokensToday(announced: Now): Promise<Now> {
    return { ...announced, tokensToday: await this.figures.tokensOn(officeDayOf(new Date())) };
  }
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
