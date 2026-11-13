import type { UserActivity } from "../domain/user-activity.js";

/** Each user's activity, by their id: where each one's Since you left begins. */
export abstract class UserActivityRepository {
  abstract find(userId: string): Promise<UserActivity | undefined>;
  /**
   * The activity of the user active last, undefined while nobody has been seen: The Office is away
   * only while every user is.
   */
  abstract findLatest(): Promise<UserActivity | undefined>;
  /**
   * Applies the change to what is kept of the user, holding it meanwhile, and returns what was
   * kept before and after.
   */
  abstract update(
    userId: string,
    change: (known: UserActivity | undefined) => UserActivity,
  ): Promise<{ readonly before: UserActivity | undefined; readonly after: UserActivity }>;
}
