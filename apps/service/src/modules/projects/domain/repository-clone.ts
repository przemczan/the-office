/** How far a clone has got, in git's words: the phase it is in and its percentage, if it gave one. */
export interface CloneProgress {
  readonly phase: string;
  readonly percent: number | undefined;
}

/** Where a clone stands: under way, done with what the Project's form needs, or failed and why. */
export type RepositoryCloneOutcome =
  | { readonly state: "cloning"; readonly progress: CloneProgress | undefined }
  | {
      readonly state: "cloned";
      /** What the remote's HEAD names, the base branch a new Project starts with. */
      readonly defaultBranch: string;
      readonly branches: readonly string[];
    }
  | { readonly state: "failed"; readonly problem: string };

/**
 * A repository cloned by its Repository URL before it is added as a Project (spec §5.5 Defaults),
 * in the background with its progress shown.
 */
export type RepositoryClone = {
  readonly id: string;
  /** The Repository URL as the user gave it. */
  readonly url: string;
  /** `<office-data>/repositories/<host>/<owner>/<repo>`. */
  readonly path: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | undefined;
} & RepositoryCloneOutcome;

export class RepositoryCloneNotFound extends Error {
  constructor(readonly cloneId: string) {
    super(`There is no clone "${cloneId}".`);
    this.name = "RepositoryCloneNotFound";
  }
}
