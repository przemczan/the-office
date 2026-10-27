import type { OpenDecision } from "../domain/now.js";

/** The Decisions waiting on the user, which Conversations keeps; the composition root binds it. */
export abstract class OpenDecisions {
  abstract listOpen(): Promise<readonly OpenDecision[]>;
}
