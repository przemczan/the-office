import type { BriefProject } from "../domain/brief.js";

/**
 * The parts of a Brief other modules keep (spec §2.5): the Projects now; a Task's record and its
 * Handover notes once Tasks exist.
 */
export abstract class BriefParts {
  /** Every Project, where a chat session reads its base branch. */
  abstract projects(): Promise<readonly BriefProject[]>;
}
