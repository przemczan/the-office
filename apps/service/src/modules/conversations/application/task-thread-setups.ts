import { Injectable } from "@nestjs/common";

/** A Thread on a Task, as the module keeping Tasks sets its session up. */
export interface TaskThreadRequest {
  readonly threadId: string;
  readonly taskId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
}

/** What a session of a Thread on a Task works with, from the Task's record. */
export interface TaskThreadSetup {
  /** The Task's worktree, which the session reads. */
  readonly folder: string;
  /** The Project's command environment. */
  readonly environment: Readonly<Record<string, string>>;
  /** Whether the session also gets the repository's own skills (spec §2.6). */
  readonly useProjectSkills: boolean;
  /**
   * What the person does in the Thread, such as planning the Task, added to their standing
   * instructions. The same for every session of the Thread, so it stays in the cached prefix.
   */
  readonly instructions: string;
  readonly officeTools: readonly string[];
  /** The Task's record as a new session picks it up (spec §2.5): never a transcript. */
  readonly brief: string;
}

/** Sets up the sessions of Threads on Tasks. */
export interface TaskThreadSource {
  setUp(thread: TaskThreadRequest): Promise<TaskThreadSetup>;
}

/**
 * Where the module keeping Tasks gives Conversations what a Thread on a Task works with. That
 * module calls Conversations to open its Threads, so it registers here instead of being called
 * through a port: a module import each way would be a cycle (apps/service/README.md).
 */
@Injectable()
export class TaskThreadSetups {
  private source: TaskThreadSource | undefined;

  provide(source: TaskThreadSource): void {
    if (this.source) throw new Error("Threads on Tasks are set up by one module only.");
    this.source = source;
  }

  /** Asked as each session starts, after every module has registered. */
  async of(thread: TaskThreadRequest): Promise<TaskThreadSetup> {
    if (!this.source) throw new Error("No module sets up the sessions of Threads on Tasks.");
    return this.source.setUp(thread);
  }
}
