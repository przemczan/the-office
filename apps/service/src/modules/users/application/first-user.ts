import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import { newUserProblems, userOf, type NewUser } from "../domain/user.js";
import { UserCreated } from "../domain/user-events.js";
import { FirstUserExists, UserRefused } from "../domain/user-refused.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { SignIns, type SignInOutcome } from "./sign-ins.js";

/**
 * The first user, created at first run (spec §2.10): while no user exists, the sign-in page asks
 * for their name, email and password instead, and signs them in.
 */
@Injectable()
export class FirstUser {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHashing: PasswordHashing,
    private readonly signIns: SignIns,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  /** Whether The Office still waits for its first user. */
  async isAwaited(): Promise<boolean> {
    return !(await this.users.anyExists());
  }

  /**
   * Creates the first user and signs them in. Throws UserRefused with every problem, and
   * FirstUserExists once a user exists, also when another first user was made meanwhile.
   */
  async create(newUser: NewUser, request: SignInRequest): Promise<SignInOutcome> {
    const problems = newUserProblems(newUser);
    if (problems.length > 0) throw new UserRefused(problems);
    if (!(await this.isAwaited())) throw new FirstUserExists();
    const now = this.schedule.now();
    const user = userOf(
      randomUUID(),
      newUser,
      await this.passwordHashing.hash(newUser.password),
      now,
    );
    if (!(await this.users.addFirst(user))) throw new FirstUserExists();
    await this.eventBus.publish(new UserCreated(user.id, now));
    return this.signIns.finish(user, "password", request);
  }
}
