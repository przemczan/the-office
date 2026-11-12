import { Injectable } from "@nestjs/common";

/** Whether the user edited the Task's own Stages, away from its Pipeline's. */
export type TaskStageEditLookup = (taskId: string) => Promise<boolean>;

/**
 * Whether a Task's Stages were edited for it (spec 2.1, "An Initiative's Pipeline"), looked up by
 * Pipelines, which keeps them and registers the lookup as it starts: Pipelines reads Tasks through
 * Work, so Work can't ask it directly (the module template's registry).
 */
@Injectable()
export class TaskStageEdits {
  private lookup: TaskStageEditLookup | undefined;

  register(lookup: TaskStageEditLookup): void {
    this.lookup = lookup;
  }

  /**
   * Throws when nothing is registered: taking an unknown answer as "not edited" would swap a
   * Pipeline the user edited for the Task.
   */
  async editedForTask(taskId: string): Promise<boolean> {
    if (!this.lookup) throw new Error("No lookup of a Task's edited Stages is registered.");
    return this.lookup(taskId);
  }
}
