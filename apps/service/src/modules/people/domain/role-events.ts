import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Role } from "./role.js";
import type { RoleCard, RoleCardField } from "./role-card.js";

export class RoleHired extends DomainEvent {
  constructor(readonly role: Role) {
    super(role.hiredAt);
  }
}

/** Sessions started from now on run with the new version; running ones keep theirs. */
export class RoleCardChanged extends DomainEvent {
  constructor(
    readonly role: Role,
    readonly previousCard: RoleCard,
    readonly changedFields: readonly RoleCardField[],
  ) {
    super(role.cardSavedAt);
  }
}
