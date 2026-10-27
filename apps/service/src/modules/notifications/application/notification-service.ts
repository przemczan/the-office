import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  DecisionAnswered,
  DecisionOpened,
  DecisionReopened,
  TurnEnded,
} from "../../conversations/index.js";
import { EngineDown, UsageWindowsChanged } from "../../engine/index.js";
import {
  DefinitionOfDoneNotMet,
  GateContinued,
  GateDropped,
  GateReached,
  NoRetriesLeft,
  SentBackFromGate,
} from "../../pipelines/index.js";
import { TaskPaused, TaskResumed, TaskStateChanged, TaskStopped } from "../../work/index.js";
import {
  decisionWaiting,
  engineDown,
  gateWaiting,
  handles,
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
import { NotificationRaised, NotificationsCleared } from "../domain/notification-events.js";
import { NotificationRepository } from "../ports/notification-repository.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { TaskStageProgress } from "../ports/task-stage-progress.js";

/** Where the user is in The Office, as the web reports it with their activity. */
export type Page =
  | { readonly kind: "now" }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "elsewhere" };

/**
 * Raises a Notification for each thing that waits on the user or happened (spec §2.7), routed to
 * its kind's channels, and clears it once the user handles that thing. Both reach the web as
 * events, where the tier 1 channels live; a Notification already open for the same thing is not
 * raised again.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  /** The 5-hour window's last reading, which the next is compared with; unknown after a restart. */
  private windowPercent = 0;

  constructor(
    private readonly repository: NotificationRepository,
    private readonly tasks: OfficeTasks,
    private readonly stages: TaskStageProgress,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.subscribeToNeedsYou();
    this.subscribeToOutcomes();
    this.subscribeToOffice();
  }

  listOpen(): Promise<readonly Notification[]> {
    return this.repository.listOpen();
  }

  /** The user opened a page: opening what a Notification points to handles it. */
  async opened(page: Page): Promise<void> {
    if (page.kind === "now") await this.handle({ kind: "now-opened" });
    if (page.kind === "task") await this.handle({ kind: "task-opened", taskId: page.taskId });
  }

  private subscribeToNeedsYou(): void {
    for (const eventClass of [DecisionOpened, DecisionReopened]) {
      this.events.subscribe(eventClass, ({ decision }) => this.raise(decisionWaiting(decision)));
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
    this.events.subscribe(TaskPaused, async ({ taskId }) => {
      await this.raise(taskPaused(taskId, (await this.tasks.read(taskId)).personRole, "pause"));
    });
    this.events.subscribe(TaskStopped, async ({ taskId }) => {
      await this.raise(taskPaused(taskId, (await this.tasks.read(taskId)).personRole, "stop"));
    });
    this.events.subscribe(TaskResumed, ({ taskId }) =>
      this.handle({ kind: "task-resumed", taskId }),
    );
    this.events.subscribe(NoRetriesLeft, async ({ taskId, stageKey }) => {
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
      if (move === "nearly-used") await this.raise(windowNearlyUsed(percent));
      if (move === "reset") {
        await this.handle({ kind: "window-reset" });
        await this.raise(windowReset());
      }
    });
    this.events.subscribe(EngineDown, ({ reason }) => this.raise(engineDown(reason)));
    // A turn that ended came back from the engine, which therefore answers again.
    this.events.subscribe(TurnEnded, () => this.handle({ kind: "engine-answered" }));
  }

  private async raiseFailure(taskId: string, failure: Failure): Promise<void> {
    await this.raise(taskFailed(taskId, (await this.tasks.read(taskId)).personRole, failure));
  }

  private async raise(draft: NotificationDraft): Promise<void> {
    const open = await this.repository.listOpen();
    if (open.some((notification) => samePointer(notification, draft))) return;
    const notification = notificationOf(draft, randomUUID(), new Date());
    await this.repository.add(notification);
    await this.events.publish(new NotificationRaised(notification));
  }

  private async handle(handling: Handling): Promise<void> {
    const open = await this.repository.listOpen();
    const handled = open.filter((notification) => handles(handling, notification));
    if (handled.length === 0) return;
    const ids = handled.map(({ id }) => id);
    await this.repository.clear(ids, new Date());
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
