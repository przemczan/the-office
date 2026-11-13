import { DomainEvent } from "../../../platform/events/domain-event.js";

// The events name the user and their devices, never a password, hash or token.

export class UserCreated extends DomainEvent {
  constructor(
    readonly userId: string,
    createdAt: Date,
  ) {
    super(createdAt);
  }
}

/** A user signed in on a new signed-in device. */
export class SignedIn extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly signedInDeviceId: string,
    signedInAt: Date,
  ) {
    super(signedInAt);
  }
}

/** Signed-in devices of a user signed out: their next request and their WebSockets are refused. */
export class SignedOut extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly signedInDeviceIds: readonly string[],
  ) {
    super();
  }
}

/** A user's password set anew, their lockout lifted. */
export class PasswordSet extends DomainEvent {
  constructor(readonly userId: string) {
    super();
  }
}
