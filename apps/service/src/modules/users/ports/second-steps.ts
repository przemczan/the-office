import type { User } from "../domain/user.js";

/**
 * A step a sign-in still needs after its way: the authenticator code, with the token of the pending
 * sign-in that waits for it, which its own cookie carries.
 */
export interface SecondStep {
  readonly outcome: "code-needed";
  readonly pendingToken: string;
}

/**
 * What a user must still do after signing in a way that isn't enough alone before they are signed
 * in (spec §2.10): an authenticator code once they set one up.
 */
export abstract class SecondSteps {
  abstract after(user: User): Promise<SecondStep | undefined>;
}
