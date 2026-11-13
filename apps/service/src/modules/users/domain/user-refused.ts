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

export class SignedInDeviceNotFound extends Error {
  constructor() {
    super("You have no such signed-in device.");
    this.name = "SignedInDeviceNotFound";
  }
}
