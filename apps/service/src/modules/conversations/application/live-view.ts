import { isDeepStrictEqual } from "node:util";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { DomainEventClass } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineModels } from "../../engine/index.js";
import {
  RoleCardChanged,
  RoleCards,
  RoleHired,
  RoleHiredBack,
  RoleLetGo,
} from "../../people/index.js";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DecisionReopened,
  DeliveryMarked,
  LiveViewChanged,
  MessagesLogged,
  ThreadStarted,
  TurnEnded,
} from "../domain/conversation-events.js";
import { liveViewOf, type LiveView as LiveViewSnapshot } from "../domain/live-view.js";
import { worksIn } from "../domain/people-working.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/** Events that may change what someone is doing, or who is listed. */
const LIVE_VIEW_CHANGES: readonly DomainEventClass[] = [
  ThreadStarted,
  TurnEnded,
  DecisionOpened,
  DecisionAnswered,
  DecisionClosed,
  DecisionReopened,
  RoleHired,
  RoleLetGo,
  RoleHiredBack,
  RoleCardChanged,
];

/**
 * The Live view's read model (spec §2.2, "What each person is doing now"): read whole from the busy
 * Threads, the people hired and their last engine calls, and announced as `LiveViewChanged` each
 * time it differs from the last one announced. Nothing is announced before the first `read`, so an
 * Office nobody watches does no reads for it; the page reads first, so it misses nothing.
 */
@Injectable()
export class LiveView implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveView.name);
  private watched = false;
  private announcing: Promise<void> | undefined;
  private announceAgain = false;
  private announced: LiveViewSnapshot | undefined;
  /**
   * The Threads busy, and those their person works in, as of the latest read begun, which tell
   * which logged messages change nothing.
   */
  private busyThreadIds: ReadonlySet<string> = new Set();
  private workingThreadIds: ReadonlySet<string> = new Set();
  /** Reads begun and the latest whose Threads were kept, so a slower older read keeps none. */
  private readsBegun = 0;
  private threadsKeptFrom = 0;

  constructor(
    private readonly threads: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly events: EventBus,
    private readonly engineModels: EngineModels,
  ) {}

  onModuleInit(): void {
    for (const eventClass of LIVE_VIEW_CHANGES) {
      this.events.subscribe(eventClass, () => this.announceInBackground());
    }
    // Messages are logged all through a turn; only those that start or end the Thread's being busy,
    // such as the user's message a turn begins with or the person's last, can change what its person
    // is doing. Waiting answers delivered may start a turn too.
    this.events.subscribe(MessagesLogged, ({ thread }) => this.announceIfBusyChanged(thread));
    this.events.subscribe(DeliveryMarked, ({ thread }) => this.announceIfBusyChanged(thread));
  }

  async onModuleDestroy(): Promise<void> {
    await this.announcing;
  }

  /**
   * An Initiative's planning Thread stays busy while its Decisions wait, yet its person works in it
   * only while answering, so a turn starting or ending there is a change as well.
   */
  private announceIfBusyChanged(thread: Thread): void {
    if (
      isBusy(thread) !== this.busyThreadIds.has(thread.id) ||
      worksIn(thread) !== this.workingThreadIds.has(thread.id)
    ) {
      this.announceInBackground();
    }
  }

  /** What each person is doing now; from the first read on, each change is announced. */
  async read(): Promise<LiveViewSnapshot> {
    this.watched = true;
    const liveView = await this.readNow();
    // The first read is what the web starts from, so a change event that changes nothing after it
    // announces nothing. Once an announcement has begun, it alone decides what was announced.
    if (this.announced === undefined && this.announcing === undefined) this.announced = liveView;
    return liveView;
  }

  private async readNow(): Promise<LiveViewSnapshot> {
    const read = ++this.readsBegun;
    const [people, threads, lastCalls, engines] = await Promise.all([
      this.roleCards.hiredPeople(),
      this.threads.busy(),
      this.threads.lastCallsByPerson(),
      this.engineModels.engines(),
    ]);
    const engineNames = new Map(engines.map(({ id, name }) => [id, name]));
    if (read > this.threadsKeptFrom) {
      this.threadsKeptFrom = read;
      this.busyThreadIds = new Set(threads.map(({ id }) => id));
      this.workingThreadIds = new Set(threads.filter(worksIn).map(({ id }) => id));
    }
    return liveViewOf({ people, threads, lastCalls, engineNames });
  }

  /**
   * Reads the Live view and announces it when it differs from the last one announced, returning at
   * once (`EventBus.publish` waits for its handlers). A burst of events while a read goes on makes
   * one more read after it, not one each.
   */
  private announceInBackground(): void {
    if (!this.watched) return;
    if (this.announcing) {
      this.announceAgain = true;
      return;
    }
    this.announcing = this.announceUntilSettled()
      .catch((error: unknown) => {
        this.logger.error("The Live view could not be read", stackOf(error));
      })
      .finally(() => {
        this.announcing = undefined;
      });
  }

  private async announceUntilSettled(): Promise<void> {
    do {
      this.announceAgain = false;
      const liveView = await this.readNow();
      if (isDeepStrictEqual(liveView, this.announced)) continue;
      this.announced = liveView;
      await this.events.publish(new LiveViewChanged(liveView));
    } while (this.announceAgain);
  }
}

function isBusy({ state, openDecisions }: Thread): boolean {
  return state === "answering" || openDecisions.length > 0;
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
