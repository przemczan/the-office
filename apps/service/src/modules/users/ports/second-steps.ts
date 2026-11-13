import type { SignInWayKind } from "../domain/sign-in-way.js";
import type { User } from "../domain/user.js";

/** A step a sign-in still needs after its way, such as an authenticator code. */
export type SecondStep = never;

/**
 * What a user must still do after signing in one way before they are signed in (spec §2.10): an
 * authenticator code once they set one up, which the authenticator's Task binds; none for now.
 */
export abstract class SecondSteps {
  abstract after(user: User, way: SignInWayKind): Promise<SecondStep | undefined>;
}
