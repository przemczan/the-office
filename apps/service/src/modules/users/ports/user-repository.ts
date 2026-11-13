import type { User } from "../domain/user.js";

/** Where users are kept. */
export abstract class UserRepository {
  /**
   * Adds the first user, only while no user exists: the check and the insert hold every other
   * add, so two first users at once make one. Says whether it was added.
   */
  abstract addFirst(user: User): Promise<boolean>;

  /** Adds a user; throws UserRefused when another user has the email. */
  abstract add(user: User): Promise<void>;

  abstract anyExists(): Promise<boolean>;

  /** The first user, the earliest created. */
  abstract first(): Promise<User | undefined>;

  /** Whether earlier records were given the first user (`EarlierRecordsClaims`). */
  abstract earlierRecordsClaimed(): Promise<boolean>;

  abstract markEarlierRecordsClaimed(at: Date): Promise<void>;

  abstract find(id: string): Promise<User | undefined>;

  /** The user with this email, compared without case. */
  abstract findByEmail(email: string): Promise<User | undefined>;

  /**
   * Applies `change` to the user as stored, holding them against other changes until it is saved,
   * so two wrong tries at once both count. Saves nothing when `change` returns undefined, and
   * nothing when it throws, which the caller then gets. Undefined when there is no such user.
   */
  abstract update(id: string, change: (user: User) => User | undefined): Promise<User | undefined>;
}
