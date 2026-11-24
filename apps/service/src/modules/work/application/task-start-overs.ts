import { Injectable } from "@nestjs/common";

/** Who starts a Task over: the user, by their id and their name then. */
export interface StartingOverUser {
  readonly userId: string;
  readonly name: string;
}

/** What a Start over did to the Task's branch. */
export interface StartedOverWork {
  /** The branch the Task's branch was reset to; undefined when it wasn't reset. */
  readonly resetTo: string | undefined;
  /** The local ref keeping the branch's old head, `refs/office/started-over/<task id>/<n>`. */
  readonly keptRef: string | undefined;
}

/**
 * The part of a Start over (and of Reopen… of a Task that had started) that is Pipelines': it keeps
 * the walk, the Stage runs and the Task's branch (spec 2.4.5, "Start over").
 */
export interface StartOverWork {
  /**
   * Why the Task's work can't be started over: a Publish Stage pushed its branch or opened a pull
   * request, or its held run is still ending its turn. Empty when it can.
   */
  refusals(taskId: string): Promise<readonly string[]>;
  /**
   * The branch a reset would take the Task's branch to: its Initiative's branch, else the
   * Project's base branch.
   */
  resetTo(taskId: string): Promise<string>;
  /**
   * Whether the Task had started: it has a Stage run, so a Start over has a walk to leave behind.
   */
  hadStarted(taskId: string): Promise<boolean>;
  /**
   * Starts the walk over: the Task's runs so far become history only, the next Start opening fresh
   * Stage sessions; with `resetBranch`, the branch is reset to the freshly fetched `resetTo`, its
   * old head kept under a local ref. Refused (it throws) as `refusals` says.
   */
  startOver(
    taskId: string,
    choice: { readonly resetBranch: boolean; readonly by: StartingOverUser },
  ): Promise<StartedOverWork>;
}

/**
 * Pipelines' part of a Start over, registered by Pipelines as it starts: Pipelines reads Tasks
 * through Work, so Work can't ask it directly (the module template's registry).
 */
@Injectable()
export class TaskStartOvers {
  private work: StartOverWork | undefined;

  register(work: StartOverWork): void {
    this.work = work;
  }

  /** Throws when nothing is registered: a Start over can't leave the walk as it was. */
  get registered(): StartOverWork {
    if (!this.work) throw new Error("No Start over of a Task's work is registered.");
    return this.work;
  }
}
