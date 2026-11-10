import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Initiative, InitiativeState } from "./initiative.js";

export class InitiativeCreated extends DomainEvent {
  constructor(readonly initiative: Initiative) {
    super(initiative.createdAt);
  }
}

export class InitiativeStateChanged extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    readonly from: InitiativeState,
    readonly to: InitiativeState,
  ) {
    super();
  }
}

/** Taken off the Initiatives board into the Archive, by the user or the daily run; its state stays. */
export class InitiativeArchived extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

/** Back on the board from the Archive, in the state it had. */
export class InitiativeRestored extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

export class InitiativeOutcomeWritten extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    readonly outcome: string,
  ) {
    super();
  }
}

/** Plan the Initiative opened its planning Thread with the Planner, in auto mode or not. */
export class InitiativePlanningStarted extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    readonly threadId: string,
    readonly autoMode: boolean,
  ) {
    super();
  }
}
