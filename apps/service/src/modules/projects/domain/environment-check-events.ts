import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { CheckState, EnvironmentCheckState } from "./environment-check.js";

/** A check of the Project's environment started. Like the others, it carries no environment. */
export class EnvironmentCheckStarted extends DomainEvent {
  constructor(
    readonly projectId: string,
    startedAt: Date,
  ) {
    super(startedAt);
  }
}

/** One check of a running environment check changed its state. */
export class EnvironmentCheckProgressed extends DomainEvent {
  constructor(
    readonly projectId: string,
    /** The check's step, or `command:<key>` for one of the Project's commands. */
    readonly check: string,
    readonly state: CheckState,
  ) {
    super();
  }
}

/** The check passed, failed or was stopped; a passed one saved its environment first. */
export class EnvironmentCheckFinished extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly state: EnvironmentCheckState,
    finishedAt: Date,
  ) {
    super(finishedAt);
  }
}
