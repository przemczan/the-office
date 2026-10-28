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
