import { Injectable } from "@nestjs/common";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import type { TaskRecord } from "../ports/task-records.js";

/**
 * One Initiative's branch in one Project at a time (spec 2.3, "A Publishing Task's Publish"): a
 * Stage of its Publishing Task runs holding it, and so does a fix Task's Publish into that branch,
 * which so waits for a running Publishing Task Stage to end before it moves the branch under it.
 */
@Injectable()
export class InitiativeBranchStages {
  private readonly locks = new KeyedLocks();

  /**
   * Runs `work` holding the Initiative's branch the Task works on or publishes into; at once for a
   * Task of the base branch. Work already holding it runs at once too.
   */
  async holding<Result>(
    task: Pick<TaskRecord, "project" | "initiativeBranch">,
    work: () => Promise<Result>,
  ): Promise<Result> {
    if (task.initiativeBranch === undefined) return work();
    return this.locks.run(`${task.project.id}/${task.initiativeBranch}`, work);
  }
}
