import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { oneTimePasswordAsTyped } from "../domain/one-time-password.js";
import {
  addedUserOf,
  isWaitingForFirstSignIn,
  profileProblems,
  removalProblems,
  removed,
  withOneTimePassword,
  type Profile,
  type User,
} from "../domain/user.js";
import { SignedOut, UserChanged, UserCreated, UserRemoved } from "../domain/user-events.js";
import { UserIdNotFound, UserRefused } from "../domain/user-refused.js";
import { AuthenticatorRepository } from "../ports/authenticator-repository.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { newOneTimePassword } from "./one-time-passwords.js";
import { PendingSignIns } from "./pending-sign-ins.js";

/** A user just added, with their one-time password, which is shown this once and kept nowhere. */
export interface AddedUser {
  readonly user: User;
  readonly oneTimePassword: string;
}

/**
 * The Office's users, as Settings › Users shows them (spec §2.10): any signed-in user adds one with
 * a one-time password, or removes one, which signs out all their devices and ends their
 * authenticator, recovery codes and pending sign-ins.
 */
@Injectable()
export class Users {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHashing: PasswordHashing,
    private readonly pendingSignIns: PendingSignIns,
    private readonly authenticators: AuthenticatorRepository,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  /** The users not removed, by name. */
  list(): Promise<readonly User[]> {
    return this.users.listActive();
  }

  /**
   * Adds a user with a one-time password. Throws UserRefused with every problem, and when a user
   * not removed has the email.
   */
  async add(profile: Profile): Promise<AddedUser> {
    const problems = profileProblems(profile);
    if (problems.length > 0) throw new UserRefused(problems);
    const oneTimePassword = newOneTimePassword();
    const now = this.schedule.now();
    const user = addedUserOf(randomUUID(), profile, await this.hashOf(oneTimePassword), now);
    await this.users.add(user);
    await this.eventBus.publish(new UserCreated(user.id, now));
    return { user, oneTimePassword };
  }

  /**
   * A new one-time password for a user who hasn't set their own yet, which ends the one before it.
   * Throws UserIdNotFound, and UserRefused once they have set their own.
   */
  async newOneTimePassword(userId: string): Promise<string> {
    const oneTimePassword = newOneTimePassword();
    const hash = await this.hashOf(oneTimePassword);
    const changed = await this.users.update(userId, (stored) => {
      if (stored.removedAt !== undefined) throw new UserIdNotFound();
      if (!isWaitingForFirstSignIn(stored)) {
        throw new UserRefused([`${stored.name} has already set their own password.`]);
      }
      return withOneTimePassword(stored, hash, this.schedule.now());
    });
    if (changed === undefined) throw new UserIdNotFound();
    await this.eventBus.publish(new UserChanged(userId));
    return oneTimePassword;
  }

  /**
   * Removes the user, `by` the signed-in user: signs out all their devices in the same
   * transaction, so none signed in meanwhile is left, ends their pending sign-ins and removes their
   * authenticator and recovery codes, and leaves their name on what they did. Throws UserRefused
   * when `by` is the user, and UserIdNotFound for no such user.
   */
  async remove(userId: string, by: string): Promise<void> {
    const removedAt = this.schedule.now();
    const removedUser = await this.users.removeAmongActive(userId, (user, activeUserIds) => {
      const problems = removalProblems(user.id, by, activeUserIds);
      if (problems.length > 0) throw new UserRefused(problems);
      return removed(user, removedAt);
    });
    if (removedUser === undefined) throw new UserIdNotFound();
    const { signedOutDeviceIds } = removedUser;
    if (signedOutDeviceIds.length > 0) {
      await this.eventBus.publish(new SignedOut(userId, signedOutDeviceIds));
    }
    await this.pendingSignIns.endAllOf(userId);
    await this.authenticators.remove(userId);
    await this.eventBus.publish(new UserRemoved(userId, removedAt));
  }

  /** The names of these users, removed ones included, for the records they made. */
  namesOf(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return this.users.namesOf(userIds);
  }

  private hashOf(oneTimePassword: string): Promise<string> {
    return this.passwordHashing.hash(oneTimePasswordAsTyped(oneTimePassword));
  }
}
