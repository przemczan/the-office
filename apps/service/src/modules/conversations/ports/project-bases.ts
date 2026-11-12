import type { BriefProject } from "../domain/brief.js";

/** Which Projects a session on an Initiative with a Pipeline reads at its Initiative's branch. */
export interface InitiativeBranchReads {
  /** The Initiative's Short name, which names the folder of its checkouts. */
  readonly shortName: string;
  /** The Initiative's branch, `initiative/<short name>`. */
  readonly branch: string;
  /** The Projects it spans that have its branch; every other is read at its base. */
  readonly projectIds: readonly string[];
}

/**
 * Each Project's base branch, checked out read-only for chat sessions, and an Initiative's branch
 * for the sessions on it, which the Projects module keeps; the composition root binds it.
 */
export abstract class ProjectBases {
  /** The folder a chat session works in: every Project's checkout is in it. */
  abstract readonly folder: string;

  /** Every Project with where its base branch is checked out, without running git. */
  abstract list(): Promise<readonly BriefProject[]>;

  /** Checks each base branch out afresh, as a chat session starts; those it couldn't are left out. */
  abstract refresh(): Promise<readonly BriefProject[]>;

  /** The folder holding the Initiative's branch checkouts, which its sessions read. */
  abstract initiativeFolder(shortName: string): string;

  /**
   * Every Project with where a session on the Initiative reads it, asking git only whether each
   * branch is there: the Brief is read before the checkouts refresh.
   */
  abstract listOnInitiative(reads: InitiativeBranchReads): Promise<readonly BriefProject[]>;

  /**
   * As `refresh`, then checks the Initiative's branch out afresh in each Project of `reads`; one that
   * fails keeps the checkout it had or is read at its base, as is one whose branch is gone.
   */
  abstract refreshOnInitiative(reads: InitiativeBranchReads): Promise<readonly BriefProject[]>;
}
