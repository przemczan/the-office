/** The Task's bases as a Brief or an answer names them. */
export interface TaskBases {
  readonly project: { readonly baseBranch: string };
  /** Its Initiative's branch, when the Task starts from and publishes into one. */
  readonly initiativeBranch?: string | undefined;
}

/**
 * What the Task's branch takes in, in order (spec §2.3, "The Task's branch keeps up with the
 * base"): "initiative/x, then main" for a Task of an Initiative with a Pipeline, else the base
 * branch alone.
 */
export function baseWords({ project, initiativeBranch }: TaskBases): string {
  return initiativeBranch === undefined
    ? project.baseBranch
    : `${initiativeBranch}, then ${project.baseBranch}`;
}
