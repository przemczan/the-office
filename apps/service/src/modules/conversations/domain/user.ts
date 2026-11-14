/**
 * A user as a record keeps them: their id and their name as it was then, so the record reads the
 * same after a rename or the user's removal. A record from before users existed has none (null)
 * until the first user claims it.
 */
export interface UserRef {
  readonly userId: string;
  readonly name: string;
}

/** The user as a record names them: "the user Ann Lee", or "the user" before users existed. */
export function userWords(user: UserRef | null): string {
  return user ? `the user ${user.name}` : "the user";
}

/** As `userWords`, opening a sentence: "The user Ann Lee". */
export function userWordsOpening(user: UserRef | null): string {
  return `T${userWords(user).slice(1)}`;
}

/** Whether two records name the same user; a record before users existed names none. */
export function sameUser(first: UserRef | null, second: UserRef | null): boolean {
  return first?.userId === second?.userId;
}
