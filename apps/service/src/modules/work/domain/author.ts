/**
 * A user as a record keeps them: their id and their name as it was then, so the record reads the
 * same after a rename or the user's removal.
 */
export interface UserRef {
  readonly userId: string;
  readonly name: string;
}

/**
 * Who captured, created or attached something: a user, or a person by the Role they fill. `user` is
 * null on a record from before users existed, until the first user claims it.
 */
export type Author =
  | {
      readonly kind: "user";
      readonly user: UserRef | null;
      /** The person, by their Role's key, who proposed what the user applied. */
      readonly proposedBy?: string;
    }
  | {
      readonly kind: "person";
      readonly roleKey: string;
      /** The user who asked for what the person did: the one whose message their Thread answered. */
      readonly askedBy?: UserRef;
      /** The user who allowed the held call the person made, where it was held for approval. */
      readonly allowedBy?: UserRef;
    };

/** The user behind an Author: the user themselves, or the one who asked the person; undefined if none. */
export function userBehind(author: Author): UserRef | undefined {
  if (author.kind === "user") return author.user ?? undefined;
  return author.allowedBy ?? author.askedBy;
}

/** The user as the Author of what they did. */
export function byTheUser(user: UserRef): Author {
  return { kind: "user", user };
}

/**
 * The Author as a record names them: "the user Ann Lee", or "the user" before users existed, with
 * the person who proposed what the user applied.
 */
export function authorWords(author: Author): string {
  if (author.kind === "person") {
    const person = personWords(author.roleKey);
    return author.askedBy ? `${person}, asked by ${author.askedBy.name}` : person;
  }
  const user = author.user ? `the user ${author.user.name}` : "the user";
  return author.proposedBy ? `${user}, proposed by ${personWords(author.proposedBy)}` : user;
}

function personWords(roleKey: string): string {
  return `the person in the Role ${roleKey}`;
}

/** Who took a Task or an Initiative into the Archive: a user, or The Office's daily run. */
export type ArchivedBy = Author | { readonly kind: "office" };

/** The daily run, archiving what has been Done or Dropped for the Archive period. */
export const BY_THE_DAILY_RUN: ArchivedBy = { kind: "office" };

export function archivedByWords(by: ArchivedBy): string {
  return by.kind === "office" ? "The Office" : authorWords(by);
}
