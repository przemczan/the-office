/** A Project's publishing mode: Push + PR, or merge. */
export type PublishingMode = "push-and-pull-request" | "merge";

/** The Task's commit message, and whether it was written or is the default. */
export interface TaskCommitMessage {
  readonly text: string;
  readonly written: boolean;
}

/** A started Task's record, as an Agent Stage works from it. */
export interface TaskRecord {
  readonly title: string;
  /** The Description, as a section of the Brief: Work words it as the Planner's has it. */
  readonly descriptionSection: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
  /** The Task's Initiative; undefined when it is in none. */
  readonly initiativeId: string | undefined;
  /**
   * The message of the one commit Publish lands the Task as (spec §2.3): the one written, or the
   * default, the title with a short summary below it, while none is (`written` false).
   */
  readonly commitMessage: TaskCommitMessage;
  /** Each of the Task's Attachments, as a line of a Brief; none when it has none. */
  readonly attachmentLines: readonly string[];
  /**
   * The records the Task is linked to (the Tasks it waits for and that wait for it, its Idea and its
   * Initiative), as a section of the Brief with how to read them; none when it is linked to none.
   */
  readonly linkedRecordsSection: string | undefined;
  /**
   * Who created the Task and who started it, or queued it to start, as a section of the Brief: Work
   * words it as its records name who did what.
   */
  readonly whoAskedSection: string;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly baseBranch: string;
    /** Its install command line; empty while not set. */
    readonly installCommand: string;
    /** Its other commands, in its order; a command line is empty while not set. */
    readonly commands: readonly {
      readonly key: string;
      readonly name: string;
      readonly commandLine: string;
    }[];
    /** Whether sessions on its Tasks also get the repository's own skills. */
    readonly useProjectSkills: boolean;
    /** The keys of the repository's skills and commands the Project turned off, each by itself. */
    readonly projectSkillsOff: readonly string[];
    /** How Publish puts work into the base branch; undefined in records made before it was kept. */
    readonly publishingMode?: PublishingMode;
  };
  /**
   * The Initiative's branch the Task starts from and publishes into, its Initiative having a
   * Pipeline, or the one a Publishing Task's worktree holds itself; undefined for a Task of the
   * base branch.
   */
  readonly initiativeBranch?: string | undefined;
  /**
   * Whether it is its Initiative's Publishing Task (spec 2.1): its worktree holds the Initiative's
   * branch itself, and its Publish puts that branch into the base branch.
   */
  readonly publishingTask?: boolean;
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
