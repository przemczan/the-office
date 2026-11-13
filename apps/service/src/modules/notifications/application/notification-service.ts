import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  DecisionAnswered,
  DecisionOpened,
  DecisionReopened,
  TurnEnded,
} from "../../conversations/index.js";
import { EngineDown, EngineRemoved, UsageWindowsChanged } from "../../engine/index.js";
import { OfficeUpdated, OfficeUpdateFailed, shortCommit } from "../../office-updates/index.js";
import { CTO, OFFICE_MANAGER } from "../../people/index.js";
import {
  DefinitionOfDoneNotMet,
  GateContinued,
  GateDropped,
  GateReached,
  NoRetriesLeft,
  SentBackFromGate,
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
  engineDown,
  gateWaiting,
  handles,
  initiativeDone,
  notificationOf,
  officeUpdated,
  officeUpdateFailed,
  samePointer,
  taskDone,
  taskFailed,
  taskPaused,
  windowMove,
  windowNearlyUsed,
  windowReset,
  type Failure,
  type Handling,
  type Notification,
  type NotificationDraft,
} from "../domain/notification.js";
import {
  collapsedOutcomes,
  emptiedGatherings,
  isOutcome,
  outcomeToJoin,
  outcomesOf,
  shownOf,
  withQuietHours,
} from "../domain/delivery.js";
import { NotificationsCleared } from "../domain/notification-events.js";
import { KnownPeople } from "../ports/known-people.js";
import { NotificationRoutingRepository } from "../ports/notification-routing-repository.js";
import { NotificationRepository } from "../ports/notification-repository.js";
import { NotificationTimingRepository } from "../ports/notification-timing-repository.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { TaskStageProgress } from "../ports/task-stage-progress.js";
import { NotificationDelivery } from "./notification-delivery.js";

/** Where the user is in The Office, as the web reports it with their activity. */
export type Page =
  | { readonly kind: "now" }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "office-update" }
  | { readonly kind: "elsewhere" };

/**
 * Raises a Notification for each thing that waits on the user or happened (spec §2.7), routed to
 * its kind's channels by the routing the user keeps in Settings, and clears it once the user handles
 * that thing. Both reach the web as events, where the browser's channels live; a Notification
 * already open for the same thing is not raised again, and an Outcome landing soon after another
 * collapses with it into one. `NotificationDelivery` sends each when the delivery rules say.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  /**
   * Each engine's 5-hour window's last reading, by engine id, which its next is compared with;
   * unknown after a restart.
   */
  private readonly windowPercents = new Map<string, number>();

  constructor(
    private readonly repository: NotificationRepository,
    private readonly tasks: OfficeTasks,
    private readonly stages: TaskStageProgress,
    private readonly people: KnownPeople,
    private readonly routing: NotificationRoutingRepository,
    private readonly timing: NotificationTimingRepository,
    private readonly delivery: NotificationDelivery,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.subscribeToNeedsYou();
    this.subscribeToOutcomes();
    this.subscribeToOffice();
  }

  /** The open Notifications as the list shows them: collapsed Outcomes in place of theirs. */
  async listOpen(): Promise<readonly Notification[]> {
    return shownOf(await this.repository.listOpen());
  }

  /** The user opened a page: opening what a Notification points to handles it. */
  async opened(page: Page): Promise<void> {
    if (page.kind === "now") await this.handle({ kind: "now-opened" });
    if (page.kind === "task") await this.handle({ kind: "task-opened", taskId: page.taskId });
    if (page.kind === "initiative") {
      await this.handle({ kind: "initiative-opened", initiativeId: page.initiativeId });
    }
    if (page.kind === "office-update") await this.handle({ kind: "office-update-opened" });
  }

  private subscribeToNeedsYou(): void {
    for (const eventClass of [DecisionOpened, DecisionReopened]) {
      // A Decision put to a Consultant waits on them, not on the user (spec §6), and a call made
      // from a chat, on no Task, goes back to its caller (spec §2.4): no Notification for either.
      this.events.subscribe(eventClass, ({ decision: { taskId, ...decision } }) =>
        decision.putTo || taskId === undefined
          ? undefined
          : this.raise(decisionWaiting({ ...decision, taskId })),
      );
    }
    this.events.subscribe(DecisionAnswered, ({ decision: { id, taskId } }) =>
      taskId === undefined
        ? undefined
        : this.handle({ kind: "decision-answered", decisionId: id, taskId }),
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
  }

  private subscribeToOutcomes(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to !== "done") return;
      await this.raise(taskDone(taskId, (await this.tasks.read(taskId)).personRole));
    });
    this.events.subscribe(TaskPaused, async ({ taskId, by }) => {
      // The user sounded the alarm, or paused the whole Initiative, themselves; Now shows what the
      // alarm holds, and the Initiative shows it is paused.
      if (by !== "user") return;
      await this.raise(taskPaused(taskId, (await this.tasks.read(taskId)).personRole, "pause"));
    });
    this.events.subscribe(TaskStopped, async ({ taskId }) => {
      await this.raise(taskPaused(taskId, (await this.tasks.read(taskId)).personRole, "stop"));
    });
    this.events.subscribe(TaskResumed, ({ taskId }) =>
      this.handle({ kind: "task-resumed", taskId }),
    );
    this.events.subscribe(InitiativeStateChanged, async ({ initiativeId, to }) => {
      if (to !== "done") return;
      await this.raise(initiativeDone(initiativeId, await this.hired(CTO)));
    });
    this.events.subscribe(NoRetriesLeft, async ({ taskId, stageKey, putTo }) => {
      // Put to the CTO first, it reaches the user only if passed on, as a Decision waiting.
      if (putTo !== undefined) return;
      const stage = await this.stageOf(taskId, stageKey);
      await this.raiseFailure(taskId, { kind: "no-retries-left", stageName: stage.name });
    });
    this.events.subscribe(DefinitionOfDoneNotMet, ({ taskId }) =>
      this.raiseFailure(taskId, { kind: "definition-of-done" }),
    );
  }

  private subscribeToOffice(): void {
    this.events.subscribe(UsageWindowsChanged, async ({ engineId, engineName, windows }) => {
      const engine = { id: engineId, name: engineName };
      const percent = windows.fiveHour.percentUsed;
      const move = windowMove(this.windowPercents.get(engineId) ?? 0, percent);
      this.windowPercents.set(engineId, percent);
      if (move === "nearly-used") {
        await this.raise(windowNearlyUsed(engine, percent, await this.officeManager()));
      }
      if (move === "reset") {
        await this.handle({ kind: "window-reset", engineId });
        await this.raise(windowReset(engine, await this.officeManager()));
      }
    });
    this.events.subscribe(EngineDown, async ({ engineId, engineName, reason }) =>
      this.raise(
        engineDown({ id: engineId, name: engineName }, reason, await this.officeManager()),
      ),
    );
    this.events.subscribe(EngineRemoved, async ({ engineId }) => {
      this.windowPercents.delete(engineId);
      await this.handle({ kind: "engine-removed", engineId });
    });
    // A newer update's result replaces what the last one's said.
    this.events.subscribe(OfficeUpdated, async ({ to }) => {
      await this.handle({ kind: "office-update-opened" });
      await this.raise(officeUpdated(shortCommit(to), await this.officeManager()));
    });
    this.events.subscribe(OfficeUpdateFailed, async ({ from, failedStep }) => {
      await this.handle({ kind: "office-update-opened" });
      await this.raise(
        officeUpdateFailed(failedStep, shortCommit(from), await this.officeManager()),
      );
    });
    // A turn that ended came back from its session's engine, which therefore answers again.
    this.events.subscribe(TurnEnded, async ({ thread }) => {
      if (thread.session)
        await this.handle({ kind: "engine-answered", engineId: thread.session.engineId });
    });
  }

  /** Who the Office kinds come from: the Office Manager while one is hired. */
  private async officeManager(): Promise<string | undefined> {
    return this.hired(OFFICE_MANAGER);
  }

  /** The Role's key while someone fills it. */
  private async hired(roleKey: string): Promise<string | undefined> {
    return (await this.people.hiredKeys()).has(roleKey) ? roleKey : undefined;
  }

  private async raiseFailure(taskId: string, failure: Failure): Promise<void> {
    await this.raise(taskFailed(taskId, (await this.tasks.read(taskId)).personRole, failure));
  }

  private async raise(draft: NotificationDraft): Promise<void> {
    const at = this.schedule.now();
    const open = await this.repository.listOpen();
    if (open.some((notification) => samePointer(notification, draft))) return;
    const [routing, timing] = await Promise.all([this.routing.read(), this.timing.read()]);
    const raised = withQuietHours(notificationOf(draft, randomUUID(), at, routing), timing, at);
    await this.repository.add(raised);
    const joined = isOutcome(raised) ? outcomeToJoin(shownOf(open), timing, at) : undefined;
    if (!joined) {
      await this.delivery.send(raised);
      return;
    }
    const outcomes = [...outcomesOf(joined, open), raised];
    const collapsed = withQuietHours(collapsedOutcomes(outcomes, randomUUID(), at), timing, at);
    await this.repository.add(collapsed);
    // An earlier collapse is replaced for good; a single Outcome waits, gathered, to be handled.
    if (joined.kind === "collapsed-outcomes") await this.repository.clear([joined.id], at);
    await this.delivery.send(collapsed, [joined.id]);
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
