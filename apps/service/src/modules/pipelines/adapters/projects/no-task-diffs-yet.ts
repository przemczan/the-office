import { Injectable } from "@nestjs/common";
import { TaskDiffs } from "../../ports/task-diffs.js";

/**
 * Knows no Task's diff yet: the Brief leaves the section out until The Office's git commits each
 * Stage's work and reads what changed (task 12, step 4).
 */
@Injectable()
export class NoTaskDiffsYet extends TaskDiffs {
  summaryOf(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}
