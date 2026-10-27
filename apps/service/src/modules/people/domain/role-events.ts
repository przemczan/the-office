import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Role } from "./role.js";
import type { RoleCardFieldChange } from "./role-card-changes.js";

export class RoleHired extends DomainEvent {
  constructor(readonly role: Role) {
    super(role.hiredAt);
  }
}

/** A Memory note was added or deleted, or the whole Memory was. */
export class RoleMemoryChanged extends DomainEvent {
  constructor(
    readonly roleKey: string,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

/** Sessions started from now on run with the new version; running ones keep theirs. */
export class RoleCardChanged extends DomainEvent {
  constructor(
    readonly role: Role,
    readonly changes: readonly RoleCardFieldChange[],
  ) {
    super(role.cardSavedAt);
  }
}
