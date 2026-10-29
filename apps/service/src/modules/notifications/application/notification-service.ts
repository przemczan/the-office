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
import { EngineDown, UsageWindowsChanged } from "../../engine/index.js";
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
  /** The 5-hour window's last reading, which the next is compared with; unknown after a restart. */
  private windowPercent = 0;

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
  }

  private subscribeToNeedsYou(): void {
    for (const eventClass of [DecisionOpened, DecisionReopened]) {
      // A Decision put to a Consultant waits on them, not on the user (spec §6): no Notification.
      this.events.subscribe(eventClass, ({ decision }) =>
        decision.putTo ? undefined : this.raise(decisionWaiting(decision)),
      );
    }
    this.events.subscribe(DecisionAnswered, ({ decision }) =>
      this.handle({ kind: "decision-answered", decisionId: decision.id, taskId: decision.taskId }),
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
      // The user sounded the alarm themselves; Now shows what it holds.
      if (by === "alarm") return;
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
    this.events.subscribe(UsageWindowsChanged, async ({ windows }) => {
      const percent = windows.fiveHour.percentUsed;
      const move = windowMove(this.windowPercent, percent);
      this.windowPercent = percent;
      if (move === "nearly-used") {
        await this.raise(windowNearlyUsed(percent, await this.officeManager()));
      }
      if (move === "reset") {
        await this.handle({ kind: "window-reset" });
        await this.raise(windowReset(await this.officeManager()));
      }
    });
    this.events.subscribe(EngineDown, async ({ reason }) =>
      this.raise(engineDown(reason, await this.officeManager())),
    );
    // A turn that ended came back from the engine, which therefore answers again.
    this.events.subscribe(TurnEnded, () => this.handle({ kind: "engine-answered" }));
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
