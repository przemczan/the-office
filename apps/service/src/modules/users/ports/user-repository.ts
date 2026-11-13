import type { User } from "../domain/user.js";

/** Where users are kept, removed ones too. */
export abstract class UserRepository {
  /**
   * Adds the first user, only while no user exists, removed ones included: the check and the
   * insert hold every other add, so two first users at once make one. Says whether it was added.
   */
  abstract addFirst(user: User): Promise<boolean>;

  /** Adds a user; throws UserRefused when a user not removed has the email. */
  abstract add(user: User): Promise<void>;

  /** Whether any user was ever made, removed ones included. */
  abstract anyExists(): Promise<boolean>;

  /** The users not removed, by name. */
  abstract listActive(): Promise<readonly User[]>;

  /** The user, removed or not. */
  abstract find(id: string): Promise<User | undefined>;

  /** The user not removed with this email, compared without case. */
  abstract findByEmail(email: string): Promise<User | undefined>;

  /** The names of these users, removed ones included, by id. */
  abstract namesOf(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;

  /**
   * Applies `change` to the user as stored, holding them against other changes until it is saved,
   * so two wrong tries at once both count. Saves nothing when `change` returns undefined, and
   * nothing when it throws, which the caller then gets. Undefined when there is no such user.
   * Throws UserRefused when the change gives them the email of another user not removed.
   */
  abstract update(id: string, change: (user: User) => User | undefined): Promise<User | undefined>;

  /**
   * Saves `remove`'s answer for the user, with every user not removed held until it is saved, so
   * two removals at once see each other's. `remove` gets the user and the ids of the users not
   * removed, and throws to refuse. Undefined when the user isn't one of those.
   */
  abstract removeAmongActive(
    id: string,
    remove: (user: User, activeUserIds: readonly string[]) => User,
  ): Promise<User | undefined>;
}
