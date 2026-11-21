/** What each user has seen of Activity's ended items, by item id. */
export abstract class ActivitySeenRepository {
  /** The ids of the items the user has seen. */
  abstract seenOf(userId: string): Promise<ReadonlySet<string>>;
  /** Keeps that the user saw these items at `at`; seeing one again keeps the later time. */
  abstract markSeen(userId: string, itemIds: readonly string[], at: Date): Promise<void>;
  /** Forgets every user's items seen before `before`. */
  abstract forgetBefore(before: Date): Promise<void>;
}
