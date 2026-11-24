import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import type { SettingChangedBy } from "../../domain/project-setting-change.js";

/** A setting changed on the Project page, by the signed-in user. */
export function byUser(signedIn: SignedIn): SettingChangedBy {
  return { kind: "user", user: userOf(signedIn) };
}
