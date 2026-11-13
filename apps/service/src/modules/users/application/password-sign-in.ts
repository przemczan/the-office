import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import { PASSWORD_WAY } from "../domain/sign-in-way.js";
import { tryRefusal, wrongTryAnswer } from "../domain/wrong-tries.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { SignIns, type SignInOutcome } from "./sign-ins.js";
import { UnknownEmailTries } from "./unknown-email-tries.js";
import { UserWrongTries } from "./user-wrong-tries.js";

/** Hashed against when the email is unknown, so the answer takes about as long as a wrong password. */
const NOBODY_S_PASSWORD = "nobody's password, never matched";

/**
 * Signing in with an email and a password (spec §2.10), slowed down and locked after wrong tries
 * (spec §2.10 Defaults). A right password undoes only its own try's count: the count is cleared once
 * the sign-in ends, so a right password never resets the wrong codes before it.
 */
@Injectable()
export class PasswordSignIn implements OnModuleInit {
  private nobodysHash: Promise<string> | undefined;

  constructor(
    private readonly users: UserRepository,
    private readonly wrongTries: UserWrongTries,
    private readonly passwordHashing: PasswordHashing,
    private readonly unknownEmailTries: UnknownEmailTries,
    private readonly signIns: SignIns,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    this.nobodysHash = this.passwordHashing.hash(NOBODY_S_PASSWORD);
  }

  /**
   * Signs the user in, or asks for their authenticator code, or throws `SignInRefused`: wrong, the
   * slow-down's wait or the lockout.
   */
  async signIn(email: string, password: string, request: SignInRequest): Promise<SignInOutcome> {
    const user = await this.users.findByEmail(email);
    if (user === undefined) return this.refuseUnknownEmail(email, password);
    const taken = await this.wrongTries.take(user.id);
    if (taken === undefined) return this.refuseUnknownEmail(email, password);
    if (!(await this.passwordHashing.matches(password, taken.user.passwordHash))) {
      throw wrongTryAnswer(taken.user.wrongTries, "password");
    }
    await this.wrongTries.undo(taken);
    return this.signIns.finish(taken.user, PASSWORD_WAY, request);
  }

  private async refuseUnknownEmail(email: string, password: string): Promise<never> {
    const now = this.schedule.now();
    const refusal = tryRefusal(this.unknownEmailTries.of(email), now);
    if (refusal !== undefined) throw refusal;
    const tries = this.unknownEmailTries.countWrong(email, now);
    await this.passwordHashing.matches(password, await this.nobodysHashed());
    throw wrongTryAnswer(tries, "password");
  }

  private nobodysHashed(): Promise<string> {
    this.nobodysHash ??= this.passwordHashing.hash(NOBODY_S_PASSWORD);
    return this.nobodysHash;
  }
}
