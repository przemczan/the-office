/** A started Task's record, as an Agent Stage works from it. */
export interface TaskRecord {
  readonly title: string;
  /** The Description, as a section of the Brief: Work words it as the Planner's has it. */
  readonly descriptionSection: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
  /** Each of the Task's Attachments, as a line of a Brief; none when it has none. */
  readonly attachmentLines: readonly string[];
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly baseBranch: string;
    /** Its commands by their key (install, build, lint, test); empty for one it doesn't run. */
    readonly commands: Readonly<Record<string, string>>;
    /** Whether sessions on its Tasks also get the repository's own skills. */
    readonly useProjectSkills: boolean;
  };
  readonly worktree: {
    readonly path: string;
    readonly branch: string;
    /** The Project's command environment. */
    readonly environment: Readonly<Record<string, string>>;
    /** Where the Agent writes its screenshots, relative to the worktree. */
    readonly screenshotsFolder: string;
  };
}

/** The started Tasks' records, which Work keeps; the composition root binds it. */
export abstract class TaskRecords {
  abstract read(taskId: string): Promise<TaskRecord>;
}
