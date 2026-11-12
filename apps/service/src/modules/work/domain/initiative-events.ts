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

/** The Initiative's Pipeline chosen, undefined for None, with the Short name it then has. */
export class InitiativePipelineChosen extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    readonly pipelineId: string | undefined,
    readonly shortName: string | undefined,
  ) {
    super();
  }
}

/** The user's own Short name for the Initiative, written while shaping. */
export class InitiativeShortNameWritten extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    readonly shortName: string,
  ) {
    super();
  }
}

/** The Initiative's branch made in a Project it came to span once active. */
export class InitiativeBranchMade extends DomainEvent {
  constructor(
    readonly initiativeId: string,
    readonly projectId: string,
    readonly branch: string,
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
