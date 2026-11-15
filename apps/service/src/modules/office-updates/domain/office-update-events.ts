import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { OfficeUpdateTarget } from "./office-update-target.js";

/** A check ended: what it found may have changed, an update newly found among it. */
export class OfficeUpdateChecked extends DomainEvent {
  constructor(
    /** The newest commit or release when there is one newer than what runs. */
    readonly available: OfficeUpdateTarget | undefined,
    /** Whether `available` is newer than what the check before found. */
    readonly newlyFound: boolean,
  ) {
    super();
  }
}

/** The user scheduled an Office update: new Starts queue and Tasks wait at their next Stage. */
export class OfficeUpdateScheduled extends DomainEvent {
  constructor(readonly target: OfficeUpdateTarget) {
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

/**
 * The launcher or the Office updater updated The Office, as the service found at its start: `from`
 * and `to` are commits for a checkout, versions for a release or a container.
 */
export class OfficeUpdated extends DomainEvent {
  constructor(
    readonly from: string,
    readonly to: string,
    finishedAt: Date,
  ) {
    super(finishedAt);
  }
}

/** The update failed, and The Office went back to the commit or version it started from. */
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
