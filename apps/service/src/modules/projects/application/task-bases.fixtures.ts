import type { Git } from "../ports/git.js";
import { TaskBases } from "./task-bases.js";

/**
 * TaskBases with Work's lookup stood in for: every Task starts from the base branch, unless a test
 * gives it an Initiative's branch.
 */
export class TaskBasesForTests extends TaskBases {
  /** The Initiative's branch of each Task that has one, by its id. */
  readonly initiativeBranches = new Map<string, string>();

  constructor(git: Git) {
    super(git);
    this.register(async (_projectId, taskId) => {
      const branch = this.initiativeBranches.get(taskId);
      return branch === undefined ? { kind: "base-branch" } : { kind: "initiative-branch", branch };
    });
  }
}
