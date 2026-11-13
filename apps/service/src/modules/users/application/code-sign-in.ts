import { Injectable } from "@nestjs/common";
import type { SignInRequest } from "../domain/signed-in-device.js";
import { PendingSignInEnded } from "../domain/user-refused.js";
import { UserRepository } from "../ports/user-repository.js";
import { AuthenticatorCodes, type CodeAnswer } from "./authenticator-codes.js";
import { PendingSignIns } from "./pending-sign-ins.js";
import { SignIns, type SignedInOutcome } from "./sign-ins.js";

/**
 * The sign-in's second step (spec §2.10): the authenticator code or a recovery code, sent with the
 * pending sign-in's token, uses it up and signs the device in. A wrong code leaves it waiting.
 */
@Injectable()
export class CodeSignIn {
  constructor(
    private readonly pendingSignIns: PendingSignIns,
    private readonly codes: AuthenticatorCodes,
    private readonly users: UserRepository,
    private readonly signIns: SignIns,
  ) {}

  /**
   * Signs the device in; throws PendingSignInEnded without a pending sign-in, used up or expired,
   * and `SignInRefused` for a wrong code, the slow-down or the lockout.
   */
  async signIn(
    pendingToken: string | undefined,
    answer: CodeAnswer,
    request: SignInRequest,
  ): Promise<SignedInOutcome> {
    const pendingSignIn =
      pendingToken === undefined ? undefined : await this.pendingSignIns.pendingOf(pendingToken);
    if (pendingSignIn === undefined) throw new PendingSignInEnded();
    await this.codes.check(pendingSignIn.userId, answer);
    if (!(await this.pendingSignIns.useUp(pendingSignIn))) throw new PendingSignInEnded();
    const user = await this.users.find(pendingSignIn.userId);
    if (user === undefined) throw new PendingSignInEnded();
    return this.signIns.signIn(user, request);
  }
}
