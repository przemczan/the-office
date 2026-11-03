import { Injectable } from "@nestjs/common";
import type { OfficeCommit } from "../domain/office-commit.js";

/** The words a Start's wait gives, and a Task held at its next Stage, while an update is scheduled. */
export const OFFICE_UPDATE_SCHEDULED = "An update is scheduled.";

export interface ScheduledOfficeUpdate {
  readonly target: OfficeCommit;
  readonly scheduledAt: Date;
}

/**
 * The Office update scheduled now, if any, which holds new Starts in the queue and each Task's next
 * Stage until it is cancelled or the service exits for it. Kept in memory: a restart cancels it.
 */
@Injectable()
export class OfficeUpdateHold {
  private scheduledUpdate: ScheduledOfficeUpdate | undefined;

  get scheduled(): ScheduledOfficeUpdate | undefined {
    return this.scheduledUpdate;
  }

  isScheduled(): boolean {
    return this.scheduledUpdate !== undefined;
  }

  /** For `OfficeUpdates` alone, which announces the change. */
  hold(update: ScheduledOfficeUpdate | undefined): void {
    this.scheduledUpdate = update;
  }
}
