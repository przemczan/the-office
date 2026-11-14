import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { byTheUser, type Author } from "../../domain/author.js";

/** The signed-in user as the Author of what their request does, named as they are now. */
export function authorOf(signedIn: SignedIn): Author {
  return byTheUser(userOf(signedIn));
}
