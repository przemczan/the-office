import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DecisionReopened,
  decisionSummary,
  TurnEnded,
} from "../../conversations/index.js";
import {
  EngineDown,
  EngineRemoved,
  UsageWindowReset,
  UsageWindowsChanged,
  UsageWindowUsedUp,
  usageWindowWords,
} from "../../engine/index.js";
import {
  OfficeUpdated,
  OfficeUpdateFailed,
  officeVersionWords,
} from "../../office-updates/index.js";
import { ActionRunStateChanged } from "../../actions/index.js";
import { CARETAKER } from "../../people/index.js";
import { TestInstanceStateChanged } from "../../test-instances/index.js";
import {
  DefinitionOfDoneNotMet,
  GateContinued,
  GateDropped,
  GateReached,
  NoRetriesLeft,
  RouteLimitReached,
  SentBackFromGate,
  StandInChoicesChanged,
} from "../../pipelines/index.js";
import {
  InitiativeStateChanged,
  TaskPaused,
  TaskResumed,
  TaskStateChanged,
  TaskStopped,
} from "../../work/index.js";
import {
  decisionWaiting,
  decisionWaitingOnInitiative,
  engineDown,
  gateWaiting,
  handles,
  initiativeDone,
  notificationOf,
  officeUpdated,
  officeUpdateFailed,
  samePointer,
  standInChoiceWaiting,
  taskDone,
  taskFailed,
  taskPaused,
  taskPausedByUsageWindow,
  actionRunFailed,
  actionRunSucceeded,
  testInstanceBuilt,
  testInstanceFailed,
  testInstanceRunning,
  windowMove,
  windowNearlyUsed,
  windowReset,
  windowUsedUp,
  type Failure,
  type Handling,
  type Notification,
  type NotificationDraft,
  type ReceivedNotification,
  type TestInstanceWords,
  type WindowReading,
} from "../domain/notification.js";
import {
  collapsedOutcomes,
  deliveryOf,
  emptiedGatherings,
  isOutcome,
  outcomeToJoin,
  outcomesOf,
  receivedOn,
  shownOf,
  withQuietHours,
} from "../domain/delivery.js";
import { NotificationsCleared } from "../domain/notification-events.js";
import { channelsOf, type Channel } from "../domain/notification-kinds.js";
import { KnownPeople } from "../ports/known-people.js";
import { NotificationRoutingRepository } from "../ports/notification-routing-repository.js";
import { NotificationRepository } from "../ports/notification-repository.js";
import { NotificationTimingRepository } from "../ports/notification-timing-repository.js";
import { OfficeInitiatives } from "../ports/office-initiatives.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { OfficeUsers } from "../ports/office-users.js";
import { StandInChoicesWaiting } from "../ports/stand-in-choices-waiting.js";
import { TaskStageProgress } from "../ports/task-stage-progress.js";
import { NotificationDelivery } from "./notification-delivery.js";

/** Before an engine's first reading since a restart: nothing used, the window not begun. */
const NO_READING: WindowReading = { percentUsed: 0, resetsAt: undefined };

/** Where the user is in The Office, as the web reports it with their activity. */
export type Page =
  | { readonly kind: "now" }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "office-update" }
  /** A Project's Test targets, with its Test instances. */
  | { readonly kind: "test-instances"; readonly projectId: string }
  /** An Action's History in a Project's Actions section. */
  | { readonly kind: "action-history"; readonly projectId: string; readonly actionKey: string }
  | { readonly kind: "elsewhere" };

/**
 * Raises a Notification for each thing that waits on the user or happened (spec §2.7), one shared by
 * every user, delivered to each on the channels their own routing in Account gives its kind, and
 * clears it for everyone once the user handles that thing. Both reach the web as events, where the
 * browser's channels live; a Notification already open for the same thing is not raised again, and
 * an Outcome landing soon after another collapses with it into one for each user by their own
 * batching. `NotificationDelivery` sends each when the delivery rules say.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  /**
   * Each engine's 5-hour window's last reading, by engine id, which its next is compared with;
   * unknown after a restart. A lower reading before the window resets leaves the last one standing.
   */
  private readonly windowReadings = new Map<string, WindowReading>();
  private readonly standInChoiceChanges = new KeyedLocks();

  constructor(
    private readonly repository: NotificationRepository,
    private readonly tasks: OfficeTasks,
    private readonly initiatives: OfficeInitiatives,
    private readonly stages: TaskStageProgress,
    private readonly people: KnownPeople,
    private readonly users: OfficeUsers,
    private readonly standInChoices: StandInChoicesWaiting,
    private readonly routing: NotificationRoutingRepository,
    private readonly timing: NotificationTimingRepository,
    private readonly delivery: NotificationDelivery,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.subscribeToNeedsYou();
    this.subscribeToOutcomes();
    this.subscribeToTestInstances();
    this.subscribeToActionRuns();
    this.subscribeToOffice();
  }

  /**
   * The open Notifications as the user's list shows them: the shared ones and their own, on their
   * channels, their collapsed Outcomes in place of theirs.
   */
  async listOpen(userId: string): Promise<readonly ReceivedNotification[]> {
    return shownOf(await this.repository.listReceived(userId));
  }

  /** The user opened a page: opening what a Notification points to handles it. */
  async opened(page: Page): Promise<void> {
    if (page.kind === "now") await this.handle({ kind: "now-opened" });
    if (page.kind === "task") await this.handle({ kind: "task-opened", taskId: page.taskId });
    if (page.kind === "initiative") {
      await this.handle({ kind: "initiative-opened", initiativeId: page.initiativeId });
    }
    if (page.kind === "office-update") await this.handle({ kind: "office-update-opened" });
    if (page.kind === "test-instances") {
      await this.handle({ kind: "test-instances-opened", projectId: page.projectId });
    }
    if (page.kind === "action-history") {
      const { projectId, actionKey } = page;
      await this.handle({ kind: "action-history-opened", projectId, actionKey });
    }
  }

  private subscribeToNeedsYou(): void {
    for (const eventClass of [DecisionOpened, DecisionReopened]) {
      // A Decision put to a Consultant waits on them, not on the user (spec §6), and a chat's waits
      // on the user inline in the chat (spec §2.7): no Notification for either. One on no Task in an
      // Initiative's Thread waits on the user about the Initiative as a whole.
      this.events.subscribe(eventClass, async ({ thread, decision }) => {
        const { id, roleKey, taskId, putTo } = decision;
        if (putTo || thread.home.kind === "chat") return;
        const question = decisionSummary(decision);
        if (taskId !== undefined) {
          await this.raise(decisionWaiting({ id, roleKey, taskId, question }));
          return;
        }
        if (thread.home.kind !== "initiative") return;
        const { initiativeId } = thread.home;
        const initiative = (await this.initiatives.list()).find((held) => held.id === initiativeId);
        if (!initiative) return;
        await this.raise(
          decisionWaitingOnInitiative({
            id,
            threadId: decision.threadId,
            initiativeId,
            initiativeTitle: initiative.name,
            roleKey,
            question,
          }),
        );
      });
    }
    // A call from a chat raised nothing, so its answer or closing finds nothing to handle.
    this.events.subscribe(DecisionAnswered, ({ decision: { id, taskId } }) =>
      this.handle({ kind: "decision-answered", decisionId: id, taskId }),
    );
    this.events.subscribe(DecisionClosed, ({ decision: { id } }) =>
      this.handle({ kind: "decision-closed", decisionId: id }),
    );
    this.events.subscribe(GateReached, async ({ taskId, stageKey }) => {
      const [gate, { personRole }] = await Promise.all([
        this.stageOf(taskId, stageKey),
        this.tasks.read(taskId),
      ]);
      await this.raise(gateWaiting(taskId, gate, personRole));
    });
    const gateActed = ({ taskId }: { readonly taskId: string }): Promise<void> =>
      this.handle({ kind: "gate-acted", taskId });
    this.events.subscribe(GateContinued, gateActed);
    this.events.subscribe(SentBackFromGate, gateActed);
    this.events.subscribe(GateDropped, gateActed);
    this.events.subscribe(StandInChoicesChanged, () => this.standInChoicesChanged());
  }

  /**
   * One Notification for every Stage waiting for the choice of a Stand-in Engine, raised when the
   * first joins and cleared once none waits; a Stage joining while it is open raises no other.
   */
  private async standInChoicesChanged(): Promise<void> {
    // One at a time, so two Stages pausing together can't each find none open and raise two.
    await this.standInChoiceChanges.run("stand-in-choice", async () => {
      const [first, ...rest] = await this.standInChoices.waiting();
      if (first === undefined) {
        await this.handle({ kind: "stand-in-choices-made" });
        return;
      }
      await this.raise(standInChoiceWaiting([first, ...rest], await this.defaultPerson()));
    });
  }

  private subscribeToOutcomes(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to !== "done") return;
      await this.raise(taskDone(taskId, (await this.tasks.read(taskId)).personRole));
    });
    this.events.subscribe(TaskPaused, async ({ taskId, by, from, usageWindow }) => {
      const { personRole } = await this.tasks.read(taskId);
      if (by === "user") {
        await this.raise(taskPaused(taskId, personRole, "pause"));
        return;
      }
      // A refusal pauses a running Task; one moving a paused Task's resume on was told already, and
      // a Task handed back to the window by its Initiative's Resume was paused by the user. A Stage
      // waiting for the choice of a Stand-in Engine is told by that Decision's Notification.
      if (
        by === "usage-window" &&
        usageWindow !== undefined &&
        usageWindow.awaitsStandInChoice !== true &&
        from !== "paused"
      ) {
        const window = usageWindowWords(usageWindow.window);
        await this.raise(taskPausedByUsageWindow(taskId, personRole, { ...usageWindow, window }));
      }
      // The user sounded the alarm, or paused the whole Initiative, themselves; Now shows what the
      // alarm holds, and the Initiative shows it is paused.
    });
    this.events.subscribe(TaskStopped, async ({ taskId }) => {
      await this.raise(taskPaused(taskId, (await this.tasks.read(taskId)).personRole, "stop"));
    });
    this.events.subscribe(TaskResumed, ({ taskId }) =>
      this.handle({ kind: "task-resumed", taskId }),
    );
    this.events.subscribe(InitiativeStateChanged, async ({ initiativeId, to }) => {
      if (to !== "done") return;
      await this.raise(
        initiativeDone(initiativeId, await this.people.holderOf("shapes-initiatives")),
      );
    });
    this.events.subscribe(NoRetriesLeft, async ({ taskId, stageKey, putTo }) => {
      // Put to a Consultant first, it reaches the user only if passed on, as a Decision waiting.
      if (putTo !== undefined) return;
      const stage = await this.stageOf(taskId, stageKey);
      await this.raiseFailure(taskId, { kind: "no-retries-left", stageName: stage.name });
    });
    this.events.subscribe(RouteLimitReached, async ({ taskId, stageKey, toStageKey, putTo }) => {
      // As a failure with no retries left: put to a Consultant first, it reaches the user later.
      if (putTo !== undefined) return;
      const stage = await this.stageOf(taskId, stageKey);
      const to = toStageKey === null ? undefined : await this.stageOf(taskId, toStageKey);
      await this.raiseFailure(taskId, {
        kind: "route-limit",
        stageName: stage.name,
        ...(to && { toName: to.name }),
      });
    });
    this.events.subscribe(DefinitionOfDoneNotMet, ({ taskId }) =>
      this.raiseFailure(taskId, { kind: "definition-of-done" }),
    );
  }

  /**
   * A test instance Running, Built or Failed is an Outcome in the UI's voice (spec §2.7 Defaults,
   * "Test instance Outcomes"); its next state makes it stale, so that clears it first. A build
   * failed by the user's own Stop or by its Initiative ending tells them nothing new.
   */
  private subscribeToTestInstances(): void {
    this.events.subscribe(TestInstanceStateChanged, async (changed) => {
      await this.handle({ kind: "test-instance-moved", instanceId: changed.instanceId });
      const draft = await this.testInstanceOutcome(changed);
      if (draft) await this.raise(draft);
    });
  }

  /**
   * A Project command or Workflow run Succeeded or Failed is an Outcome in the UI's voice; a Test
   * target run's instance raises its own, and a Stopped run tells nothing (spec §2.7, "Action run
   * Outcomes"). Only the Action's latest is left open.
   */
  private subscribeToActionRuns(): void {
    this.events.subscribe(ActionRunStateChanged, async (changed) => {
      const { runId, projectId, actionKey, actionName, branch, kind, outcome } = changed;
      if (kind === "test-target") return;
      if (outcome !== "succeeded" && outcome !== "failed") return;
      await this.handle({ kind: "action-history-opened", projectId, actionKey });
      const run = { runId, projectId, actionKey, actionName, branch };
      await this.raise(
        outcome === "succeeded"
          ? actionRunSucceeded(run)
          : actionRunFailed(run, changed.endedBecause ?? ""),
      );
    });
  }

  private async testInstanceOutcome(
    changed: TestInstanceStateChanged,
  ): Promise<NotificationDraft | undefined> {
    switch (changed.to) {
      case "running":
        return testInstanceRunning(await this.testInstanceWords(changed));
      case "built":
        return testInstanceBuilt(await this.testInstanceWords(changed), changed.files);
      case "failed": {
        const { stoppedBy, failedReason = "" } = changed;
        if (stoppedBy === "by-user" || stoppedBy === "initiative-ended") return undefined;
        return testInstanceFailed(await this.testInstanceWords(changed), failedReason);
      }
      case "building":
      case "stopped":
        return undefined;
    }
  }

  private async testInstanceWords(changed: TestInstanceStateChanged): Promise<TestInstanceWords> {
    const { instanceId, projectId, initiativeId, branch, targetName } = changed;
    const initiative =
      initiativeId === undefined
        ? undefined
        : (await this.initiatives.list()).find((held) => held.id === initiativeId);
    return {
      instanceId,
      projectId,
      initiativeId,
      initiativeTitle: initiative?.name,
      branch,
      targetName,
    };
  }

  private subscribeToOffice(): void {
    this.events.subscribe(UsageWindowsChanged, async ({ engineId, engineName, windows }) => {
      const engine = { id: engineId, name: engineName };
      const current = windows.fiveHour;
      const previous = this.windowReadings.get(engineId) ?? NO_READING;
      const move = windowMove(previous, current, this.schedule.now());
      const dipped = move !== "reset" && current.percentUsed < previous.percentUsed;
      if (!dipped) this.windowReadings.set(engineId, current);
      if (move === "nearly-used") {
        await this.raise(windowNearlyUsed(engine, current.percentUsed, await this.defaultPerson()));
      }
      if (move === "reset") {
        await this.handle({ kind: "window-reset", engineId });
        await this.raise(windowReset(engine, await this.defaultPerson()));
      }
    });
    this.events.subscribe(UsageWindowUsedUp, async ({ engineId, engineName, window, resetsAt }) => {
      // A later refusal moving the reset on replaces what was said.
      await this.handle({ kind: "used-up-window-reset", engineId });
      await this.raise(
        windowUsedUp(
          { id: engineId, name: engineName },
          { window: usageWindowWords(window), resetsAt },
          await this.defaultPerson(),
        ),
      );
    });
    this.events.subscribe(UsageWindowReset, ({ engineId }) =>
      this.handle({ kind: "used-up-window-reset", engineId }),
    );
    this.events.subscribe(EngineDown, async ({ engineId, engineName, reason }) =>
      this.raise(
        engineDown({ id: engineId, name: engineName }, reason, await this.defaultPerson()),
      ),
    );
    this.events.subscribe(EngineRemoved, async ({ engineId }) => {
      this.windowReadings.delete(engineId);
      await this.handle({ kind: "engine-removed", engineId });
    });
    // A newer update's result replaces what the last one's said.
    this.events.subscribe(OfficeUpdated, async ({ to }) => {
      await this.handle({ kind: "office-update-opened" });
      await this.raise(officeUpdated(officeVersionWords(to), await this.defaultPerson()));
    });
    this.events.subscribe(OfficeUpdateFailed, async ({ from, failedStep }) => {
      await this.handle({ kind: "office-update-opened" });
      await this.raise(
        officeUpdateFailed(failedStep, officeVersionWords(from), await this.defaultPerson()),
      );
    });
    // A turn that ended came back from its session's engine, which therefore answers again.
    this.events.subscribe(TurnEnded, async ({ thread }) => {
      if (thread.session)
        await this.handle({ kind: "engine-answered", engineId: thread.session.engineId });
    });
  }

  /**
   * Who the Office kinds come from (spec §2.7): whoever holds Default person to talk to, or the
   * Caretaker while nobody does.
   */
  private async defaultPerson(): Promise<string> {
    return (await this.people.holderOf("default-person-to-talk-to")) ?? CARETAKER;
  }

  private async raiseFailure(taskId: string, failure: Failure): Promise<void> {
    await this.raise(taskFailed(taskId, (await this.tasks.read(taskId)).personRole, failure));
  }

  private async raise(draft: NotificationDraft): Promise<void> {
    const at = this.schedule.now();
    const open = await this.repository.listOpen();
    if (open.some((notification) => samePointer(notification, draft))) return;
    const raised = notificationOf(draft, randomUUID(), at);
    await this.repository.add(raised);
    for (const { id: userId } of await this.users.list()) {
      await this.deliver(userId, raised, channelsOf(draft.kind, await this.routing.read(userId)));
    }
  }

  /**
   * The Notification just raised, to one user on the channels their routing gives it, by their
   * own quiet hours and batching; a user with no channel for it gets nothing.
   */
  private async deliver(
    userId: string,
    raised: Notification,
    channels: readonly Channel[],
  ): Promise<void> {
    if (channels.length === 0) return;
    const at = raised.raisedAt;
    const [timing, received] = await Promise.all([
      this.timing.read(userId),
      this.repository.listReceived(userId),
    ]);
    const delivered = withQuietHours(receivedOn(raised, channels), timing, at);
    await this.repository.deliver(deliveryOf(delivered, userId));
    // Only what reached the user joins: an Outcome on none of their channels was never shown them.
    const open = received.filter((each) => each.id !== raised.id && each.channels.length > 0);
    const joined = isOutcome(delivered) ? outcomeToJoin(shownOf(open), timing, at) : undefined;
    if (!joined) {
      await this.delivery.send(userId, delivered);
      return;
    }
    const outcomes = [...outcomesOf(joined, open), delivered];
    const collapsed = withQuietHours(
      collapsedOutcomes(outcomes, userId, randomUUID(), at),
      timing,
      at,
    );
    await this.repository.add(collapsed);
    await this.repository.deliver(deliveryOf(collapsed, userId));
    // The user's earlier collapse is replaced for good; a single Outcome waits, gathered, to be
    // handled.
    if (joined.kind === "collapsed-outcomes") await this.repository.clear([joined.id], at);
    await this.delivery.send(userId, collapsed, [joined.id]);
  }

  private async handle(handling: Handling): Promise<void> {
    const open = await this.repository.listOpen();
    const handled = open.filter((notification) => handles(handling, notification));
    if (handled.length === 0) return;
    const stillOpen = open.filter((notification) => !handled.includes(notification));
    const ids = [...handled, ...emptiedGatherings(stillOpen)].map(({ id }) => id);
    await this.repository.clear(ids, this.schedule.now());
    await this.events.publish(new NotificationsCleared(ids));
  }

  /** The Stage's name as the Task's own Stages have it, its key when they no longer do. */
  private async stageOf(
    taskId: string,
    stageKey: string,
  ): Promise<{ readonly key: string; readonly name: string }> {
    const stages = (await this.stages.progress(taskId))?.stages ?? [];
    const stage = stages.find(({ stage: { key } }) => key === stageKey)?.stage;
    return { key: stageKey, name: stage?.name ?? stageKey };
  }
}
