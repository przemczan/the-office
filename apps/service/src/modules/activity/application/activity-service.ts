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
} from "../../conversations/index.js";
import { ConnectedDeviceChanged } from "../../devices/index.js";
import { StageRunEnded, StageRunStarted } from "../../pipelines/index.js";
import {
  CiRunsChecked,
  EnvironmentCheckFinished,
  EnvironmentCheckStarted,
  PullRequestClosed,
  PullRequestMerged,
  PullRequestReopened,
  PullRequestsChecked,
} from "../../projects/index.js";
import { TestInstanceLaunched, TestInstanceStateChanged } from "../../test-instances/index.js";
import { TaskResumed, TaskStateChanged, TaskStopped } from "../../work/index.js";
import {
  activityOf,
  endedCutOf,
  seenCutOf,
  type Activity,
  type ActivityParts,
  type StartedActivityTask,
} from "../domain/activity.js";
import { ActivityChanged } from "../domain/activity-events.js";
import { ActivityCiRuns } from "../ports/activity-ci-runs.js";
import { ActivityDecisions } from "../ports/activity-decisions.js";
import { ActivityDevices } from "../ports/activity-devices.js";
import { ActivityEnvironmentChecks } from "../ports/activity-environment-checks.js";
import { ActivityOnboardings } from "../ports/activity-onboardings.js";
import { ActivityPullRequests } from "../ports/activity-pull-requests.js";
import { ActivitySeenRepository } from "../ports/activity-seen-repository.js";
import { ActivityStages } from "../ports/activity-stages.js";
import { ActivityTasks } from "../ports/activity-tasks.js";
import { ActivityTestInstances } from "../ports/activity-test-instances.js";

/** The events of the modules Activity reads that can change what it lists. */
const SOURCE_CHANGES: readonly DomainEventClass[] = [
  TaskStateChanged,
  TaskStopped,
  TaskResumed,
  StageRunStarted,
  StageRunEnded,
  DecisionOpened,
  DecisionAnswered,
  DecisionClosed,
  DecisionReopened,
  TestInstanceLaunched,
  TestInstanceStateChanged,
  CiRunsChecked,
  EnvironmentCheckStarted,
  EnvironmentCheckFinished,
  PullRequestsChecked,
  PullRequestMerged,
  PullRequestClosed,
  PullRequestReopened,
  ConnectedDeviceChanged,
];

/**
 * Activity (spec §2.14): everything The Office is running, read afresh from the modules that own
 * each part, with each user's ended items left out once they have seen them. Each change of a
 * source, and each user marking items seen, is announced as one `ActivityChanged` per burst.
 */
@Injectable()
export class ActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivityService.name);
  private announcing: Promise<void> | undefined;
  private announceAgain = false;

  constructor(
    private readonly tasks: ActivityTasks,
    private readonly stages: ActivityStages,
    private readonly decisions: ActivityDecisions,
    private readonly onboardings: ActivityOnboardings,
    private readonly testInstances: ActivityTestInstances,
    private readonly ciRuns: ActivityCiRuns,
    private readonly environmentChecks: ActivityEnvironmentChecks,
    private readonly pullRequests: ActivityPullRequests,
    private readonly devices: ActivityDevices,
    private readonly seen: ActivitySeenRepository,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    for (const eventClass of SOURCE_CHANGES) {
      this.events.subscribe(eventClass, () => this.announceInBackground());
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.announcing;
  }

  /** The user's Activity: what runs, and what ended that they haven't seen. */
  async read(userId: string): Promise<Activity> {
    const now = this.schedule.now();
    // A scope of its own: what each started Task's Stages read in common is read once.
    const [parts, seenIds] = await Promise.all([
      inReadScope(() => this.parts(now)),
      this.seen.seenOf(userId),
    ]);
    return activityOf(parts, seenIds, now);
  }

  /** The user has seen these items; what they saw over 30 days ago is forgotten meanwhile. */
  async markSeen(userId: string, itemIds: readonly string[]): Promise<void> {
    const now = this.schedule.now();
    await this.seen.markSeen(userId, itemIds, now);
    await this.seen.forgetBefore(seenCutOf(now));
    this.announceInBackground();
  }

  private async parts(now: Date): Promise<ActivityParts> {
    const cut = endedCutOf(now);
    const [
      started,
      done,
      openDecisions,
      onboardings,
      testInstances,
      environmentChecks,
      devices,
      { pullRequests },
    ] = await Promise.all([
      this.startedTasks(),
      this.tasks.doneSince(cut).then((ids) => this.tasks.findAll(ids)),
      this.decisions.listOpen(),
      this.onboardings.list(),
      this.testInstances.activity(cut),
      this.environmentChecks.latestOfAll(),
      this.devices.open(),
      this.pullRequests.list(),
    ]);
    return {
      started,
      done: done.filter(({ state }) => state === "done"),
      openDecisionTaskIds: new Set(openDecisions.flatMap(({ taskId }) => taskId ?? [])),
      onboardings,
      testInstances,
      ciRuns: this.ciRuns.list().runs,
      environmentChecks,
      devices,
      pullRequests,
    };
  }

  private async startedTasks(): Promise<StartedActivityTask[]> {
    return readEach(await this.tasks.started(), async (task) => {
      const [stateChanges, progress] = await Promise.all([
        this.tasks.stateChangesOf(task.id),
        this.stages.progress(task.id),
      ]);
      return { task, stateChanges, stages: progress?.stages ?? [] };
    });
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
