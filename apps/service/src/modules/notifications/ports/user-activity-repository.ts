import type { UserActivity } from "../domain/user-activity.js";

/** The user's activity, in one row. */
export abstract class UserActivityRepository {
  abstract find(): Promise<UserActivity | undefined>;
  /** Applies the change to what is kept, holding it meanwhile, and returns what it kept. */
  abstract update(change: (known: UserActivity | undefined) => UserActivity): Promise<UserActivity>;
}
