/** A user as Projects records who acted: their id and their name as it was then. */
export interface ActingUser {
  readonly userId: string;
  readonly name: string;
}

/**
 * A person who acted through their Office tools, by their Role's key, with the user who asked them
 * and the one whose Allow once let a held call run, where known (spec §6, The record).
 */
export interface ActingPerson {
  readonly kind: "person";
  readonly roleKey: string;
  /** The Task whose Thread the person acted from; none from a chat. */
  readonly taskId?: string;
  readonly askedBy?: ActingUser;
  readonly allowedBy?: ActingUser;
}

/**
 * Who asked an action of Projects that records who did it: the signed-in user (a Proposal they
 * applied included), or a person.
 */
export type ActedBy = { readonly kind: "user"; readonly user: ActingUser } | ActingPerson;

/** The signed-in user as who acted. */
export function byTheUser({ userId, name }: ActingUser): ActedBy {
  return { kind: "user", user: { userId, name } };
}
