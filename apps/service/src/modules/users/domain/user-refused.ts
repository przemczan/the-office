/** A change to a user refused, with every reason in the UI's words. */
export class UserRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "UserRefused";
  }
}

/** The first user asked for once The Office has one. */
export class FirstUserExists extends Error {
  constructor() {
    super("The Office already has its first user: sign in instead.");
    this.name = "FirstUserExists";
  }
}

export class UserNotFound extends Error {
  constructor(email: string) {
    super(`No user has the email ${email}.`);
    this.name = "UserNotFound";
  }
}

/** A user asked for by id that isn't one of The Office's users, or was removed. */
export class UserIdNotFound extends Error {
  constructor() {
    super("No such user.");
    this.name = "UserIdNotFound";
  }
}

export class SignedInDeviceNotFound extends Error {
  constructor() {
    super("You have no such signed-in device.");
    this.name = "SignedInDeviceNotFound";
  }
}

/** A passkey asked for by id that isn't one of the signed-in user's. */
export class PasskeyNotFound extends Error {
  constructor() {
    super("You have no such passkey.");
    this.name = "PasskeyNotFound";
  }
}

export class LinkedIdentityNotFound extends Error {
  constructor() {
    super("You have no such linked identity.");
    this.name = "LinkedIdentityNotFound";
  }
}
