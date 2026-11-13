import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  passwordProblems,
  profileProblems,
  withAppearance,
  withPassword,
  withProfile,
  type Appearance,
  type Profile,
  type User,
} from "../domain/user.js";
import { PasswordSet, UserChanged } from "../domain/user-events.js";
import { UserIdNotFound, UserRefused } from "../domain/user-refused.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { PasswordChecks } from "./password-checks.js";
import { SignedInDevices } from "./signed-in-devices.js";

/** What changing one's own password takes. */
export interface PasswordChange {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** A user's own record (spec §2.10, the account): their profile, password and appearance. */
@Injectable()
export class Accounts {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordChecks: PasswordChecks,
    private readonly passwordHashing: PasswordHashing,
    private readonly signedInDevices: SignedInDevices,
    private readonly eventBus: EventBus,
  ) {}

  of(userId: string): Promise<User | undefined> {
    return this.users.find(userId);
  }

  /**
   * Changes the user's name, email or both; throws UserRefused with every problem, a taken email
   * too.
   */
  changeProfile(userId: string, change: Partial<Profile>): Promise<User> {
    return this.change(userId, (user) => {
      const profile = { name: change.name ?? user.name, email: change.email ?? user.email };
      const problems = profileProblems(profile);
      if (problems.length > 0) throw new UserRefused(problems);
      return withProfile(user, profile);
    });
  }

  /**
   * Changes the user's password, the current one checked as any password is, slow-down and lockout
   * included, and signs out every other device of theirs; this one stays signed in. Throws
   * UserRefused for a new password the rules refuse or a wrong current one, and SignInRefused for
   * the slow-down's wait or the lockout.
   */
  async changePassword(
    userId: string,
    signedInDeviceId: string,
    { currentPassword, newPassword }: PasswordChange,
  ): Promise<void> {
    const user = await this.users.find(userId);
    if (user === undefined || user.removedAt !== undefined) throw new UserIdNotFound();
    const problems = passwordProblems(newPassword, user.email);
    if (problems.length > 0) throw new UserRefused(problems);
    await this.passwordChecks.currentUserOf(userId, currentPassword);
    const passwordHash = await this.passwordHashing.hash(newPassword);
    const set = await this.users.update(userId, (stored) => withPassword(stored, passwordHash));
    if (set === undefined) throw new UserIdNotFound();
    await this.signedInDevices.signOutOthers(userId, signedInDeviceId);
    await this.eventBus.publish(new PasswordSet(userId));
  }

  /** Keeps the user's palette and density, which follow them to every browser they sign in on. */
  setAppearance(userId: string, appearance: Appearance): Promise<User> {
    return this.change(userId, (user) => withAppearance(user, appearance));
  }

  private async change(userId: string, change: (user: User) => User | undefined): Promise<User> {
    let changed = false;
    const user = await this.users.update(userId, (stored) => {
      if (stored.removedAt !== undefined) throw new UserIdNotFound();
      const next = change(stored);
      changed = next !== undefined;
      return next;
    });
    if (user === undefined) throw new UserIdNotFound();
    if (changed) await this.eventBus.publish(new UserChanged(userId));
    return user;
  }
}
