import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { SignInRefused } from "../domain/sign-in-refused.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import { isOneTimePasswordExpired, isWaitingForFirstSignIn } from "../domain/user.js";
import { PasswordChecks } from "./password-checks.js";
import { SignIns, type SignInOutcome } from "./sign-ins.js";

/**
 * Signing in with an email and a password (spec §2.10). A right one-time password signs nobody in:
 * it answers `set-password`, and `FirstPassword` takes it again with the user's own.
 */
@Injectable()
export class PasswordSignIn {
  constructor(
    private readonly passwordChecks: PasswordChecks,
    private readonly signIns: SignIns,
    private readonly schedule: Schedule,
  ) {}

  /** Signs the user in, or throws `SignInRefused`: wrong, the slow-down's wait or the lockout. */
  async signIn(email: string, password: string, request: SignInRequest): Promise<SignInOutcome> {
    const user = await this.passwordChecks.userWith(email, password);
    if (isWaitingForFirstSignIn(user)) {
      if (isOneTimePasswordExpired(user, this.schedule.now())) throw SignInRefused.expired();
      return { outcome: "set-password" };
    }
    return this.signIns.finish(user, "password", request);
  }
}
