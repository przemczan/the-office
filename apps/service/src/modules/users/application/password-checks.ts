import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { oneTimePasswordAsTyped } from "../domain/one-time-password.js";
import { SignInRefused } from "../domain/sign-in-refused.js";
import { isWaitingForFirstSignIn, type User } from "../domain/user.js";
import { UserIdNotFound, UserRefused } from "../domain/user-refused.js";
import { tryRefusal, wrongTryAnswer } from "../domain/wrong-tries.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { UnknownEmailTries } from "./unknown-email-tries.js";
import { UserWrongTries } from "./user-wrong-tries.js";

/** Hashed against when the email is unknown, so the answer takes about as long as a wrong password. */
const NOBODY_S_PASSWORD = "nobody's password, never matched";

/**
 * Checking a user's password, their one-time password included, wherever one is asked for: slowed
 * down and locked after wrong tries (spec §2.10 Defaults), counted with the user's wrong codes. A
 * right password undoes only its own try's count: the count is cleared once a sign-in ends, so a
 * right password never resets the wrong codes before it.
 */
@Injectable()
export class PasswordChecks implements OnModuleInit {
  private nobodysHash: Promise<string> | undefined;

  constructor(
    private readonly users: UserRepository,
    private readonly wrongTries: UserWrongTries,
    private readonly passwordHashing: PasswordHashing,
    private readonly unknownEmailTries: UnknownEmailTries,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    this.nobodysHash = this.passwordHashing.hash(NOBODY_S_PASSWORD);
  }

  /**
   * The user with this email, once `password` is theirs. Throws `SignInRefused`: wrong, the
   * slow-down's wait or the lockout. An unknown or removed user's email gets the same answers.
   */
  async userWith(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (user === undefined) return this.refuseUnknownEmail(email, password);
    return (await this.userOf(user.id, password)) ?? this.refuseUnknownEmail(email, password);
  }

  /**
   * The user, once `password` is theirs, as `userWith` checks it; undefined when there is no such
   * user, or they were removed.
   */
  async userOf(userId: string, password: string): Promise<User | undefined> {
    const taken = await this.wrongTries.take(userId);
    if (taken === undefined) return undefined;
    if (!(await this.matches(password, taken.user))) {
      throw wrongTryAnswer(taken.user.wrongTries, "password");
    }
    await this.wrongTries.undo(taken);
    return { ...taken.user, wrongTries: taken.before };
  }

  /**
   * The signed-in user, once `currentPassword` is theirs, asked again before a change to their
   * account, under the same checks. Throws UserRefused for a wrong one, SignInRefused for the
   * slow-down's wait or the lockout, and UserIdNotFound when they were removed.
   */
  async currentUserOf(userId: string, currentPassword: string): Promise<User> {
    let user: User | undefined;
    try {
      user = await this.userOf(userId, currentPassword);
    } catch (error) {
      if (error instanceof SignInRefused && error.refusal === "wrong") {
        throw new UserRefused(["The current password is wrong."]);
      }
      throw error;
    }
    if (user === undefined) throw new UserIdNotFound();
    return user;
  }

  private matches(password: string, user: User): Promise<boolean> {
    if (user.passwordHash === undefined) return Promise.resolve(false);
    const typed = isWaitingForFirstSignIn(user) ? oneTimePasswordAsTyped(password) : password;
    return this.passwordHashing.matches(typed, user.passwordHash);
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
