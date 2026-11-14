import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { passwordProblems, withPassword, type User } from "../domain/user.js";
import { PasswordSet } from "../domain/user-events.js";
import { UserNotFound, UserRefused } from "../domain/user-refused.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { PendingSignIns } from "./pending-sign-ins.js";
import { SignedInDevices } from "./signed-in-devices.js";

/** Setting a user's password anew, as the recovery command on the host does (spec §2.10). */
@Injectable()
export class Passwords {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHashing: PasswordHashing,
    private readonly signedInDevices: SignedInDevices,
    private readonly pendingSignIns: PendingSignIns,
    private readonly eventBus: EventBus,
  ) {}

  /** The user with this email; throws UserNotFound when there is none. */
  async userWith(email: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (user === undefined) throw new UserNotFound(email);
    return user;
  }

  /**
   * Sets the user's password, lifts their lockout, signs out all their signed-in devices and ends
   * their pending sign-ins, which the old password started.
   * Throws UserNotFound for an unknown email and UserRefused for a password the rules refuse.
   */
  async set(email: string, password: string): Promise<void> {
    const user = await this.userWith(email);
    const problems = passwordProblems(password, user.email);
    if (problems.length > 0) throw new UserRefused(problems);
    const passwordHash = await this.passwordHashing.hash(password);
    const updated = await this.users.update(user.id, (stored) =>
      withPassword(stored, passwordHash),
    );
    if (updated === undefined) throw new UserNotFound(email);
    await this.signedInDevices.signOutAll(user.id);
    await this.pendingSignIns.endAllOf(user.id);
    await this.eventBus.publish(new PasswordSet(user.id));
  }
}
