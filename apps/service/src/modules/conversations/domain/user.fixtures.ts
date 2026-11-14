import type { Answerer } from "./decision.js";
import type { UserRef } from "./user.js";

/** The user the test apps take every request as signed in by (`SIGNED_IN_FOR_TESTS`). */
export const ANN_LEE: UserRef = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };

/** The second user, whom a request names with `signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS)`. */
export const BEN_ITO: UserRef = { userId: "00000000-0000-4000-8000-0000000005e2", name: "Ben Ito" };

/** Ann Lee answering a Decision herself, as the Decisions card does for her. */
export const ANSWERED_BY_ANN_LEE: Answerer = { kind: "user", user: ANN_LEE };
