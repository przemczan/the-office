/**
 * A user as a record keeps them: their id and their name as it was then, so the record reads the
 * same after a rename or the user's removal. A record from before users existed has none (null)
 * until the first user claims it.
 */
export interface UserRef {
  readonly userId: string;
  readonly name: string;
}
