import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { BusyWorkChanged, ScheduledExitCancelled } from "../domain/office-update-events.js";
import type { ScheduledExit, ScheduledExitKind } from "../domain/scheduled-exit.js";
import { BusyWork } from "./busy-work.js";
import { ScheduledExitHold } from "./scheduled-exit-hold.js";

/**
 * Carries out a scheduled exit of its kind once nothing is busy: `exit` when the service is to
 * exit now, `stay` when something else carries it on while the service runs. Throws when it
 * couldn't be handed over, which leaves it scheduled.
 */
export type GoAhead = (exit: ScheduledExit) => Promise<"exit" | "stay">;

/**
 * The scheduled Office update or restart (spec §5.1 Defaults), one at a time: it holds new work
 * through `ScheduledExitHold`, and once nothing is busy goes ahead with what its kind registered.
 * The service exits for it through `onReadyToExit`'s listeners.
 */
@Injectable()
export class ScheduledExits implements OnModuleInit {
  private readonly logger = new Logger(ScheduledExits.name);
  private readonly goAheads = new Map<ScheduledExitKind, GoAhead>();
  private readonly readyListeners: (() => void)[] = [];
  private goingAhead = false;

  constructor(
    private readonly hold: ScheduledExitHold,
    private readonly busyWork: BusyWork,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(BusyWorkChanged, () => this.goAheadIfIdle());
  }

  /** Registers how a scheduled exit of `kind` goes ahead. */
  carryOut(kind: ScheduledExitKind, goAhead: GoAhead): void {
    this.goAheads.set(kind, goAhead);
  }

  /** Calls `listener` once the service is to exit for the update or restart it handed over. */
  onReadyToExit(listener: () => void): void {
    this.readyListeners.push(listener);
  }

  get scheduled(): ScheduledExit | undefined {
    return this.hold.scheduled;
  }

  /** Whether the scheduled exit has gone ahead, so it can't be cancelled any more. */
  get underWay(): boolean {
    return this.goingAhead;
  }

  /** Holds new work for `exit`, announces it, and goes ahead at once when nothing is busy. */
  async schedule(exit: ScheduledExit, announcement: DomainEvent): Promise<void> {
    this.hold.hold(exit);
    await this.events.publish(announcement);
    await this.goAheadIfIdle();
  }

  /** Lets go of the scheduled exit, so what it held goes on. */
  async cancel(): Promise<void> {
    this.hold.hold(undefined);
    this.goingAhead = false;
    await this.events.publish(new ScheduledExitCancelled());
  }

  private async goAheadIfIdle(): Promise<void> {
    const scheduled = this.hold.scheduled;
    if (!scheduled || this.goingAhead || this.busyWork.list().length > 0) return;
    const goAhead = this.goAheads.get(scheduled.kind);
    if (!goAhead) throw new Error(`Nothing carries out a scheduled ${scheduled.kind}.`);
    this.goingAhead = true;
    let gone: "exit" | "stay";
    try {
      gone = await goAhead(scheduled);
    } catch (error) {
      // Left scheduled, so the user sees it and can cancel it, or the next change tries again.
      this.goingAhead = false;
      this.logger.error(`The Office ${scheduled.kind} wasn't handed over: ${String(error)}`);
      return;
    }
    if (gone === "exit") for (const listener of this.readyListeners) listener();
  }
}
