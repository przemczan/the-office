import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import {
  NO_WRONG_TRIES,
  afterWrongTry,
  tryRefusal,
  wrongTryAnswer,
} from "../domain/wrong-tries.js";
import type { User } from "../domain/user.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { SignIns, type SignInOutcome } from "./sign-ins.js";
import { UnknownEmailTries } from "./unknown-email-tries.js";

/** Hashed against when the email is unknown, so the answer takes about as long as a wrong password. */
const NOBODY_S_PASSWORD = "nobody's password, never matched";

/**
 * Signing in with an email and a password (spec §2.10), slowed down and locked after wrong tries
 * (spec §2.10 Defaults). A try is counted wrong before the password is checked and the count
 * cleared once it matches, so tries sent at once can't slip past the slow-down.
 */
@Injectable()
export class PasswordSignIn implements OnModuleInit {
  private nobodysHash: Promise<string> | undefined;

  constructor(
    private readonly users: UserRepository,
    private readonly passwordHashing: PasswordHashing,
    private readonly unknownEmailTries: UnknownEmailTries,
    private readonly signIns: SignIns,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    this.nobodysHash = this.passwordHashing.hash(NOBODY_S_PASSWORD);
  }

  /**
   * Signs the user in, or throws `SignInRefused`: wrong, the slow-down's wait or the lockout.
   */
  async signIn(email: string, password: string, request: SignInRequest): Promise<SignInOutcome> {
    const user = await this.users.findByEmail(email);
    if (user === undefined) return this.refuseUnknownEmail(email, password);
    const counted = await this.users.update(user.id, (stored) => this.takeTry(stored));
    if (counted === undefined) return this.refuseUnknownEmail(email, password);
    if (!(await this.passwordHashing.matches(password, counted.passwordHash))) {
      throw wrongTryAnswer(counted.wrongTries);
    }
    const signedIn = await this.users.update(user.id, (stored) => ({
      ...stored,
      wrongTries: NO_WRONG_TRIES,
    }));
    return this.signIns.finish(signedIn ?? counted, "password", request);
  }

  /** The user with this try counted wrong; throws the refusal when no try is taken now. */
  private takeTry(user: User): User {
    const now = this.schedule.now();
    const refusal = tryRefusal(user.wrongTries, now);
    if (refusal !== undefined) throw refusal;
    return { ...user, wrongTries: afterWrongTry(user.wrongTries, now) };
  }

  private async refuseUnknownEmail(email: string, password: string): Promise<never> {
    const now = this.schedule.now();
    const refusal = tryRefusal(this.unknownEmailTries.of(email), now);
    if (refusal !== undefined) throw refusal;
    const tries = this.unknownEmailTries.countWrong(email, now);
    await this.passwordHashing.matches(password, await this.nobodysHashed());
    throw wrongTryAnswer(tries);
  }

  private nobodysHashed(): Promise<string> {
    this.nobodysHash ??= this.passwordHashing.hash(NOBODY_S_PASSWORD);
    return this.nobodysHash;
  }
}
