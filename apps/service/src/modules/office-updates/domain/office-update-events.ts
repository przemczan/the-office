import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { OfficeCommit } from "./office-commit.js";

/** A check ended: what it found may have changed, an update newly found among it. */
export class OfficeUpdateChecked extends DomainEvent {
  constructor(
    /** The upstream's newest commit when the checkout is behind it. */
    readonly available: OfficeCommit | undefined,
    /** Whether `available` is newer than what the check before found. */
    readonly newlyFound: boolean,
  ) {
    super();
  }
}

/** The user scheduled an Office update: new Starts queue and Tasks wait at their next Stage. */
export class OfficeUpdateScheduled extends DomainEvent {
  constructor(readonly target: OfficeCommit) {
    super();
  }
}

/** The user cancelled the scheduled update: what it held goes on. */
export class OfficeUpdateCancelled extends DomainEvent {}

/** The work going on now changed: an update scheduled waits for what is left. */
export class BusyWorkChanged extends DomainEvent {
  constructor(readonly count: number) {
    super();
  }
}

/** The launcher updated The Office, as the service found at its start. */
export class OfficeUpdated extends DomainEvent {
  constructor(
    readonly from: string,
    readonly to: string,
    finishedAt: Date,
  ) {
    super(finishedAt);
  }
}

/** The launcher's update failed, and it went back to the commit it started from. */
export class OfficeUpdateFailed extends DomainEvent {
  constructor(
    readonly from: string,
    readonly to: string,
    /** The failed step, in the UI's words. */
    readonly failedStep: string,
    finishedAt: Date,
  ) {
    super(finishedAt);
  }
}
