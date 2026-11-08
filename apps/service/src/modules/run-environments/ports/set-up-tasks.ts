/** A Project's "Set up the run environment" Task, as Work keeps it. */
export interface SetUpTask {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly state: string;
}

/**
 * The "Set up the run environment" Tasks, which Work makes and keeps, at most one open per Project;
 * refusals come as `RunEnvironmentSettingRefused`.
 */
export abstract class SetUpTasks {
  /** The Project's open one, neither Done nor Dropped; undefined when it has none. */
  abstract openOf(projectId: string): Promise<SetUpTask | undefined>;

  /** The Project's open one, added now, as the user asked, when it has none. */
  abstract add(projectId: string): Promise<SetUpTask>;

  /** Undefined when the Task isn't a set-up Task. */
  abstract setUpTaskOf(taskId: string): Promise<SetUpTask | undefined>;
}
