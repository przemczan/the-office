/** A Task as a start from it reads it. */
export interface SourceTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  /** Done or Dropped: no start runs from it. */
  readonly ended: boolean;
  /** `office/<task id>`; undefined for a Task that holds no branch of its own. */
  readonly branch: string | undefined;
}

/** An Initiative as a start from it reads it. */
export interface SourceInitiative {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  /** Its branch in each Project The Office made it in. */
  readonly branches: readonly { readonly projectId: string; readonly branch: string }[];
}

/**
 * Work's side of a start (spec §5.3, "Actions"): the Task or Initiative a run runs from, and
 * whether the fire alarm is on.
 */
export abstract class ActionSources {
  abstract taskOf(taskId: string): Promise<SourceTask | undefined>;

  abstract initiativeOf(initiativeId: string): Promise<SourceInitiative | undefined>;

  abstract fireAlarmOn(): Promise<boolean>;
}
