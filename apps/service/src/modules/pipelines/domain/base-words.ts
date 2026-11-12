/** The Task's bases as a Brief or an answer names them. */
export interface TaskBases {
  readonly project: { readonly baseBranch: string };
  /** Its Initiative's branch, when the Task starts from and publishes into one. */
  readonly initiativeBranch?: string | undefined;
  /** Whether it is a Publishing Task, whose branch is the Initiative's branch itself. */
  readonly publishingTask?: boolean;
}

/**
 * What the Task's branch takes in, in order (spec §2.3, "The Task's branch keeps up with the
 * base"): "initiative/x, then main" for a Task of an Initiative with a Pipeline, else the base
 * branch alone, as for a Publishing Task, whose branch is the Initiative's own.
 */
export function baseWords({ project, initiativeBranch, publishingTask }: TaskBases): string {
  return initiativeBranch === undefined || publishingTask
    ? project.baseBranch
    : `${initiativeBranch}, then ${project.baseBranch}`;
}

/** How a Publishing Task's Publish puts the Initiative's branch into the base branch. */
export function publishingModeWords(
  mode: "push-and-pull-request" | "merge" | undefined,
  branch: string,
  baseBranch: string,
): string {
  return mode === "push-and-pull-request"
    ? `a pull request from ${branch} into ${baseBranch}`
    : `the base merged in with one merge commit, then ${baseBranch} fast-forwarded`;
}
