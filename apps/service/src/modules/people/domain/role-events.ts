import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Role } from "./role.js";
import type { RoleCardFieldChange } from "./role-card-changes.js";

export class RoleHired extends DomainEvent {
  constructor(readonly role: Role) {
    super(role.hiredAt);
  }
}

/** The person no longer fills the Role: Pipelines that name it need someone else. */
export class RoleLetGo extends DomainEvent {
  constructor(
    readonly role: Role,
    letGoAt: Date,
  ) {
    super(letGoAt);
  }
}

/** The person let go fills their Role again, with their card, Memory and chats as they were. */
export class RoleHiredBack extends DomainEvent {
  constructor(
    readonly role: Role,
    hiredBackAt: Date,
  ) {
    super(hiredBackAt);
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

/** The person's picture changed or went; the Role card, and so every session, stays as it was. */
export class RoleAvatarChanged extends DomainEvent {
  constructor(
    readonly role: Role,
    changedAt: Date,
  ) {
    super(changedAt);
  }
}
