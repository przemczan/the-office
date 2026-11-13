import { useQuery } from "@tanstack/react-query";
import type { UserRef } from "@the-office/contracts";
import { useCallback } from "react";
import { userQueries } from "../api/users.ts";

/** The signed-in user as a record names them: "You" opening a line, "you" within one. */
export type You = "You" | "you";

/** Names a user a record keeps: `you` for the signed-in user, their name otherwise. */
export type UserNamer = (user: UserRef | null, you?: You) => string;

/**
 * Whether the record is the signed-in user's: theirs by id, or one from before users existed
 * (`null`), which reads as it always did.
 */
export function isSignedInUser(user: UserRef | null, signedInUserId: string | undefined): boolean {
  return user === null || user.userId === signedInUserId;
}

/** "You" for the signed-in user, or on a record from before users existed; the name otherwise. */
export function userName(
  user: UserRef | null,
  signedInUserId: string | undefined,
  you: You = "You",
): string {
  return user !== null && user.userId !== signedInUserId ? user.name : you;
}

/** The signed-in user's id, from the account query, once it has answered. */
export function useSignedInUserId(): string | undefined {
  return useQuery(userQueries.account()).data?.id;
}

/** `userName` for the signed-in user of this browser. */
export function useUserName(): UserNamer {
  const signedInUserId = useSignedInUserId();
  return useCallback(
    (user: UserRef | null, you: You = "You") => userName(user, signedInUserId, you),
    [signedInUserId],
  );
}
