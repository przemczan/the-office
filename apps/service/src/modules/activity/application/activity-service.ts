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
  DeliveryMarked,
  MessagesLogged,
  ThreadSeen,
  ThreadStarted,
  TurnEnded,
} from "../../conversations/index.js";
import { ConnectedDeviceChanged } from "../../devices/index.js";
import {
  GateContinued,
  GateDropped,
  GateReached,
  SentBackFromGate,
  StageRunEnded,
  StageRunStarted,
} from "../../pipelines/index.js";
import {
  CiRunsChecked,
  EnvironmentCheckFinished,
  EnvironmentCheckStarted,
} from "../../projects/index.js";
import { ActionRunStarted, ActionRunStateChanged } from "../../actions/index.js";
import { TestInstanceLaunched, TestInstanceStateChanged } from "../../test-instances/index.js";
import {
  TaskLeftQueue,
  TaskMovedUpInQueue,
  TaskQueued,
  TaskQueueReasonsChanged,
  TaskResumed,
  TaskStateChanged,
  TaskStopped,
} from "../../work/index.js";
import {
  activityOf,
  isOffBoard,
  type Activity,
  type ActivityParts,
  type ActivityTask,
  type ActivityThreadSession,
  type StartedActivityTask,
} from "../domain/activity.js";
import { ActivityChanged } from "../domain/activity-events.js";
import { ActivityCiRuns } from "../ports/activity-ci-runs.js";
import { ActivityDecisions } from "../ports/activity-decisions.js";
import { ActivityDevices } from "../ports/activity-devices.js";
import { ActivityEnvironmentChecks } from "../ports/activity-environment-checks.js";
import { ActivityOffBoardTasks } from "../ports/activity-off-board-tasks.js";
import { ActivityInitiatives } from "../ports/activity-initiatives.js";
import { ActivitySessions } from "../ports/activity-sessions.js";
import { ActivityStages } from "../ports/activity-stages.js";
import { ActivityTasks } from "../ports/activity-tasks.js";
import { ActivityTestInstances } from "../ports/activity-test-instances.js";
import { ActivityActionRuns } from "../ports/activity-action-runs.js";

/** The events of the modules Activity reads that can change what it lists. */
const SOURCE_CHANGES: readonly DomainEventClass[] = [
  TaskStateChanged,
  TaskStopped,
  TaskResumed,
  // An Off-board Task's place in the queue and its reasons.
  TaskQueued,
  TaskLeftQueue,
  TaskQueueReasonsChanged,
  TaskMovedUpInQueue,
  StageRunStarted,
  StageRunEnded,
  GateReached,
  GateContinued,
  SentBackFromGate,
  GateDropped,
  // A session starts, ends, or starts or stops waiting.
  ThreadStarted,
  TurnEnded,
  ThreadSeen,
  DecisionOpened,
  DecisionAnswered,
  DecisionClosed,
  DecisionReopened,
  TestInstanceLaunched,
  TestInstanceStateChanged,
  ActionRunStarted,
  ActionRunStateChanged,
  CiRunsChecked,
  EnvironmentCheckStarted,
  EnvironmentCheckFinished,
  ConnectedDeviceChanged,
];

/** Where a Thread stands for sessions: answering, and whether a Decision is open on it. */
function sessionStandOf({
  state,
  openDecisions,
}: {
  readonly state: string;
  readonly openDecisions: readonly unknown[];
}): string {
  return `${state}:${openDecisions.length > 0}`;
}

const IDLE_STAND = sessionStandOf({ state: "waiting", openDecisions: [] });

/**
 * Activity (spec §2.14): the active sessions and the other running work, read afresh from the
 * modules that own each part for the signed-in user. Each change of a source is announced as one
 * `ActivityChanged` per burst.
 */
@Injectable()
export class ActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivityService.name);
  private announcing: Promise<void> | undefined;
  private announceAgain = false;
  /** Where each Thread last stood, which tells the logged messages that change no session. */
  private readonly threadStands = new Map<string, string>();

  constructor(
    private readonly tasks: ActivityTasks,
    private readonly initiatives: ActivityInitiatives,
    private readonly sessions: ActivitySessions,
    private readonly stages: ActivityStages,
    private readonly decisions: ActivityDecisions,
    private readonly offBoardTasks: ActivityOffBoardTasks,
    private readonly testInstances: ActivityTestInstances,
    private readonly actionRuns: ActivityActionRuns,
    private readonly ciRuns: ActivityCiRuns,
    private readonly environmentChecks: ActivityEnvironmentChecks,
    private readonly devices: ActivityDevices,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    for (const eventClass of SOURCE_CHANGES) {
      this.events.subscribe(eventClass, () => this.announceInBackground());
    }
    // Messages are logged all through a turn; only those that start or end a session, or its
    // waiting, change what Activity lists.
    this.events.subscribe(MessagesLogged, ({ thread }) => this.announceIfStandChanged(thread));
    this.events.subscribe(DeliveryMarked, ({ thread }) => this.announceIfStandChanged(thread));
  }

  async onModuleDestroy(): Promise<void> {
    await this.announcing;
  }

  /** The user's Activity: the active sessions, and the other work running now. */
  async read(userId: string): Promise<Activity> {
    const now = this.schedule.now();
    // A scope of its own: what each started Task's Stages read in common is read once.
    return activityOf(await inReadScope(() => this.parts(userId, now)));
  }

  private async parts(userId: string, now: Date): Promise<ActivityParts> {
    const [
      threadSessions,
      started,
      openDecisions,
      offBoardTasks,
      testInstances,
      actionRuns,
      environmentChecks,
      devices,
    ] = await Promise.all([
      this.sessions.sessionsFor(userId),
      this.startedTasks(),
      this.decisions.listOpen(),
      this.offBoardTasks.listAll(),
      // Those Building or Running; any ended before now are left out by the domain.
      this.testInstances.activity(now),
      this.actionRuns.runningCommandRuns(),
      this.environmentChecks.latestOfAll(),
      this.devices.open(),
    ]);
    const [otherTasks, initiativeTitles] = await this.subjectsOf(threadSessions, started);
    return {
      threadSessions,
      started,
      otherTasks,
      initiativeTitles,
      openDecisionTaskIds: new Set(openDecisions.flatMap(({ taskId }) => taskId ?? [])),
      offBoardTasks,
      testInstances,
      actionRuns,
      ciRuns: this.ciRuns.list().runs,
      environmentChecks,
      devices,
    };
  }

  /** The Tasks the sessions are on that aren't started, and the titles of their Initiatives. */
  private async subjectsOf(
    sessions: readonly ActivityThreadSession[],
    started: readonly StartedActivityTask[],
  ): Promise<[readonly ActivityTask[], ReadonlyMap<string, string>]> {
    const startedIds = new Set(started.map(({ task }) => task.id));
    const taskIds = new Set<string>();
    const initiativeIds = new Set<string>();
    for (const { subject } of sessions) {
      if (subject.kind === "task" && !startedIds.has(subject.taskId)) taskIds.add(subject.taskId);
      if (subject.kind === "initiative") initiativeIds.add(subject.initiativeId);
    }
    const [otherTasks, initiatives] = await Promise.all([
      taskIds.size === 0 ? [] : this.tasks.findAll([...taskIds]),
      initiativeIds.size === 0 ? [] : this.initiatives.titlesOf([...initiativeIds]),
    ]);
    return [
      otherTasks,
      new Map(initiatives.map(({ initiativeId, title }) => [initiativeId, title])),
    ];
  }

  private async startedTasks(): Promise<StartedActivityTask[]> {
    // An Off-board Task is listed as its own kind, from what Work reads of it.
    const started = (await this.tasks.started()).filter((task) => !isOffBoard(task));
    return readEach(started, async (task) => {
      const progress = await this.stages.progress(task.id);
      return { task, stages: progress?.stages ?? [] };
    });
  }

  private announceIfStandChanged(
    thread: Parameters<typeof sessionStandOf>[0] & { id: string },
  ): void {
    const stand = sessionStandOf(thread);
    if (stand === (this.threadStands.get(thread.id) ?? IDLE_STAND)) return;
    if (stand === IDLE_STAND) this.threadStands.delete(thread.id);
    else this.threadStands.set(thread.id, stand);
    this.announceInBackground();
  }

  /**
   * Announces `ActivityChanged` in the background, returning at once (`EventBus.publish` waits for
   * its handlers); a burst of changes while one is announced makes one more after it, not one each.
   */
  private announceInBackground(): void {
    if (this.announcing) {
      this.announceAgain = true;
      return;
    }
    // Once the events published along with this one have come too.
    this.announcing = Promise.resolve()
      .then(() => this.events.publish(new ActivityChanged()))
      .catch((error: unknown) => {
        this.logger.error("Activity's change could not be announced", stackOf(error));
      })
      .finally(() => {
        this.announcing = undefined;
        if (this.announceAgain) {
          this.announceAgain = false;
          this.announceInBackground();
        }
      });
  }
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
