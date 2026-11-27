import type { Author } from "@the-office/contracts";
import type { ActedBy, ActingUser } from "../../domain/acted-by.js";

/** Who acted, as the API names an Author. */
export function toAuthorResponse(by: ActedBy): Author {
  if (by.kind === "user") return { kind: "user", user: userOf(by.user) };
  return {
    kind: "person",
    roleKey: by.roleKey,
    ...(by.askedBy && { askedBy: userOf(by.askedBy) }),
    ...(by.allowedBy && { allowedBy: userOf(by.allowedBy) }),
  };
}

function userOf({ userId, name }: ActingUser): ActingUser {
  return { userId, name };
}
