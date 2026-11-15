import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { basicsOf } from "../domain/first-run-setup.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import { newUserProblems, userOf, type NewUser } from "../domain/user.js";
import { FirstRunBasicsClosed, UserCreated } from "../domain/user-events.js";
import { FirstUserExists, UserRefused } from "../domain/user-refused.js";
import { PasswordHashing } from "../ports/password-hashing.js";
import { UserRepository } from "../ports/user-repository.js";
import { EarlierRecordsClaims } from "./earlier-records-claims.js";
import { FirstRunSetup } from "./first-run-setup.js";
import { SignIns, type SignedInOutcome } from "./sign-ins.js";

/**
 * The first user, created at first run (spec §2.10): while no user exists, the sign-in page asks
 * for the setup token printed on the host, then their name, email and password, and signs them in.
 */
@Injectable()
export class FirstUser {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHashing: PasswordHashing,
    private readonly signIns: SignIns,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
    private readonly earlierRecordsClaims: EarlierRecordsClaims,
    private readonly firstRunSetup: FirstRunSetup,
  ) {}

  /** Whether The Office still waits for its first user. */
  async isAwaited(): Promise<boolean> {
    return !(await this.users.anyExists());
  }

  /**
   * Creates the first user with the waiting setup token, uses the token up and opens First-run
   * setup's basics, gives them the records made before users existed, and signs them in. Throws
   * SetupTokenRefused before anything else is checked, UserRefused with every problem, and
   * FirstUserExists once a user exists, also when another first user was made meanwhile.
   */
  async create(
    newUser: NewUser,
    setupToken: string,
    request: SignInRequest,
  ): Promise<SignedInOutcome> {
    await this.firstRunSetup.checkToken(setupToken);
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
    const setupAfterwards = await this.firstRunSetup.afterFirstUser(now);
    if (!(await this.users.addFirst(user, setupAfterwards))) throw new FirstUserExists();
    await this.eventBus.publish(new UserCreated(user.id, now));
    if (basicsOf(setupAfterwards) === "closed") {
      await this.eventBus.publish(new FirstRunBasicsClosed(now));
    }
    await this.earlierRecordsClaims.claimIfDue();
    // Just made, the user has no authenticator yet to ask a code of.
    return this.signIns.signIn(user, request);
  }
}
