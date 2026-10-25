import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { CheckState, EnvironmentCheck } from "./environment-check.js";

export class EnvironmentCheckStarted extends DomainEvent {
  constructor(readonly check: EnvironmentCheck) {
    super(check.startedAt);
  }
}

/** One check of a running environment check changed its state. */
export class EnvironmentCheckProgressed extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly step: EnvironmentCheck["checks"][number]["step"],
    readonly state: CheckState,
  ) {
    super();
  }
}

/** The check passed, failed or was stopped; a passed one saved its environment first. */
export class EnvironmentCheckFinished extends DomainEvent {
  constructor(readonly check: EnvironmentCheck) {
    super(check.finishedAt);
  }
}
