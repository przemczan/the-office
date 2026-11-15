import { Injectable } from "@nestjs/common";
import type { ScheduledExit } from "../domain/scheduled-exit.js";

/** The words a Start's wait gives, and a Task held at its next Stage, while an update is scheduled. */
export const OFFICE_UPDATE_SCHEDULED = "An update is scheduled.";
/** The same words while a restart is scheduled. */
export const OFFICE_RESTART_SCHEDULED = "A restart is scheduled.";

/** Why work waits for a scheduled exit: the reason, and its short form for a badge. */
export interface ScheduledExitWait {
  readonly reason: string;
  readonly short: string;
}

/**
 * The Office update or restart scheduled now, if any, which holds new Starts in the queue and each
 * Task's next Stage until it is cancelled or the service exits for it. Kept in memory: a restart
 * cancels it.
 */
@Injectable()
export class ScheduledExitHold {
  private scheduledExit: ScheduledExit | undefined;

  get scheduled(): ScheduledExit | undefined {
    return this.scheduledExit;
  }

  isScheduled(): boolean {
    return this.scheduledExit !== undefined;
  }

  /** Why work waits now, in the UI's words; undefined when nothing is scheduled. */
  waitWords(): ScheduledExitWait | undefined {
    switch (this.scheduledExit?.kind) {
      case "update":
        return { reason: OFFICE_UPDATE_SCHEDULED, short: "Office update scheduled" };
      case "restart":
        return { reason: OFFICE_RESTART_SCHEDULED, short: "Office restart scheduled" };
      case undefined:
        return undefined;
    }
  }

  /** For `ScheduledExits` alone, which announces the change. */
  hold(exit: ScheduledExit | undefined): void {
    this.scheduledExit = exit;
  }
}
