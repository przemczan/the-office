import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { SignInRefused } from "../domain/sign-in-refused.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import { PASSWORD_WAY } from "../domain/sign-in-way.js";
import {
  isOneTimePasswordExpired,
  isWaitingForFirstSignIn,
  passwordProblems,
  withPassword,
} from "../domain/user.js";
import { PasswordSet, UserChanged } from "../domain/user-events.js";
import { UserRefused } from "../domain/user-refused.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { PasswordChecks } from "./password-checks.js";
import { SignIns, type SignInOutcome } from "./sign-ins.js";

/** What setting one's own password at the first sign-in takes. */
export interface FirstPasswordRequest {
  readonly email: string;
  readonly oneTimePassword: string;
  readonly password: string;
}

/**
 * A user added by another sets their own password at their first sign-in (spec §2.10): their
 * one-time password, checked again as any password is, slow-down and lockout included, then
 * their own, after which they are signed in as any password sign-in ends.
 */
@Injectable()
export class FirstPassword {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordChecks: PasswordChecks,
    private readonly passwordHashing: PasswordHashing,
    private readonly signIns: SignIns,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Sets the password and signs the user in, or asks for their authenticator code. Throws UserRefused for a password the rules refuse,
   * and SignInRefused for a wrong or expired one-time password, the slow-down or the lockout.
   */
  async set(
    { email, oneTimePassword, password }: FirstPasswordRequest,
    request: SignInRequest,
  ): Promise<SignInOutcome> {
    const problems = passwordProblems(password, email);
    if (problems.length > 0) throw new UserRefused(problems);
    const user = await this.passwordChecks.userWith(email, oneTimePassword);
    // Their own password, right, is no one-time password: it signs in on the sign-in page instead.
    if (!isWaitingForFirstSignIn(user)) throw SignInRefused.wrong("password");
    if (isOneTimePasswordExpired(user, this.schedule.now())) throw SignInRefused.expired();
    const passwordHash = await this.passwordHashing.hash(password);
    const set = await this.users.update(user.id, (stored) => {
      // Two tries with the same one-time password at once: only the first sets a password.
      if (stored.passwordHash !== user.passwordHash) throw SignInRefused.wrong("password");
      return withPassword(stored, passwordHash);
    });
    if (set === undefined) throw SignInRefused.wrong("password");
    await this.eventBus.publish(new PasswordSet(set.id));
    // Settings › Users stops saying they wait for their first sign-in.
    await this.eventBus.publish(new UserChanged(set.id));
    return this.signIns.finish(set, PASSWORD_WAY, request);
  }
}
