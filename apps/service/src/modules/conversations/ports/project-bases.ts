import type { BriefProject } from "../domain/brief.js";

/**
 * Each Project's base branch, checked out read-only for chat sessions, which the Projects module
 * keeps; the composition root binds it.
 */
export abstract class ProjectBases {
  /** The folder a chat session works in: every Project's checkout is in it. */
  abstract readonly folder: string;

  /** Every Project with where its base branch is checked out, without running git. */
  abstract list(): Promise<readonly BriefProject[]>;

  /** Checks each base branch out afresh, as a chat session starts; those it couldn't are left out. */
  abstract refresh(): Promise<readonly BriefProject[]>;
}
