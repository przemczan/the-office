import type { Git } from "../ports/git.js";
import { TaskBases } from "./task-bases.js";

/**
 * TaskBases with Work's lookup stood in for: every Task starts from the base branch, unless a test
 * gives it an Initiative's branch, or makes it a Publishing Task of one.
 */
export class TaskBasesForTests extends TaskBases {
  /** The Initiative's branch of each Task that has one, by its id. */
  readonly initiativeBranches = new Map<string, string>();
  /** The Initiative's branch each Publishing Task holds, by its id. */
  readonly publishingTasks = new Map<string, string>();

  constructor(git: Git) {
    super(git);
    this.register(async (_projectId, taskId) => {
      const publishing = this.publishingTasks.get(taskId);
      if (publishing !== undefined) return { kind: "publishing-task", branch: publishing };
      const branch = this.initiativeBranches.get(taskId);
      return branch === undefined ? { kind: "base-branch" } : { kind: "initiative-branch", branch };
    });
  }
}
