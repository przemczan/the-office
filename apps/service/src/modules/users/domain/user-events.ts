import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { IdentityProviderId } from "./linked-identity.js";

// The events name the user and their devices, never a password, hash, token, secret or code.

export class UserCreated extends DomainEvent {
  constructor(
    readonly userId: string,
    createdAt: Date,
  ) {
    super(createdAt);
  }
}

/**
 * A user's name, email or appearance changed, their one-time password was made anew, or they set
 * their own password in place of it.
 */
export class UserChanged extends DomainEvent {
  constructor(readonly userId: string) {
    super();
  }
}

/**
 * A user removed: their devices are signed out and they can no longer sign in. Their row stays, so
 * records keep their name. Anything of theirs a later module keeps, such as a linked identity or a
 * passkey, is cleaned up on this event.
 */
export class UserRemoved extends DomainEvent {
  constructor(
    readonly userId: string,
    removedAt: Date,
  ) {
    super(removedAt);
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

/** A user's authenticator turned on, confirmed with a first code. */
export class AuthenticatorSetUp extends DomainEvent {
  constructor(readonly userId: string) {
    super();
  }
}

/** A user's authenticator turned off, by the user or the host command, their recovery codes gone. */
export class AuthenticatorRemoved extends DomainEvent {
  constructor(readonly userId: string) {
    super();
  }
}

/** A new set of recovery codes made for a user, the old set no longer working. */
export class RecoveryCodesMade extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly count: number,
  ) {
    super();
  }
}

/** One of a user's recovery codes used, and how many are left. */
export class RecoveryCodeUsed extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly left: number,
  ) {
    super();
  }
}

/** A user added a passkey from their account. */
export class PasskeyAdded extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly passkeyId: string,
    addedAt: Date,
  ) {
    super(addedAt);
  }
}

export class PasskeyRenamed extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly passkeyId: string,
  ) {
    super();
  }
}

/** A user removed a passkey: it signs nobody in any more. */
export class PasskeyRemoved extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly passkeyId: string,
  ) {
    super();
  }
}

/** A user linked their identity at a provider from their account. */
export class IdentityLinked extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly provider: IdentityProviderId,
    linkedAt: Date,
  ) {
    super(linkedAt);
  }
}

/** A user unlinked their identity at a provider: it signs nobody in any more. */
export class IdentityUnlinked extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly provider: IdentityProviderId,
  ) {
    super();
  }
}
