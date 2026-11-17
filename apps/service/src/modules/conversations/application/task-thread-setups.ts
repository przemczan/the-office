import { Injectable } from "@nestjs/common";
import { isPersonsThread, type Thread } from "../domain/thread.js";
import type { PlanningThreadElsewhere } from "../domain/conversation-tabs.js";
import type { InitiativeBranchReads } from "../ports/project-bases.js";

/** A Thread on a Task, as the module keeping Tasks sets its session up. */
export interface TaskThreadRequest {
  readonly taskId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
  /** A person's own Thread on the Task, not a Stage's or a Consultation's (spec §2.4). */
  readonly personsThread: boolean;
  /** No session ran in the Thread yet. */
  readonly firstSession: boolean;
}

/** What the module keeping Tasks is asked about the Thread on `taskId`. */
export function taskThreadRequest(thread: Thread, taskId: string): TaskThreadRequest {
  return {
    taskId,
    roleKey: thread.roleKey,
    personsThread: isPersonsThread(thread),
    firstSession: thread.session === undefined,
  };
}

/** What a session of a Thread on a Task works with, from the Task's record. */
export interface TaskThreadSetup {
  /** The Task's Project, whose Memory notes the person's sessions read. */
  readonly projectId: string;
  /** The Task's Initiative; undefined when it is in none. */
  readonly initiativeId: string | undefined;
  /**
   * The names of the Task's Project and of its Pipeline, which its sessions' telemetry carries; the
   * Pipeline's `""` while the Task has none.
   */
  readonly projectName: string;
  readonly pipelineName: string;
  /**
   * The Task's worktree, which the session reads; undefined while the Task has none yet, as one
   * planned in its Initiative's Thread, when the session reads the Projects' checkouts instead.
   */
  readonly folder: string | undefined;
  /**
   * With no worktree, the Projects read at the Initiative's branch of the Task's Initiative, as its
   * Threads read them; undefined, or left out, reads every base branch.
   */
  readonly branchReads?: InitiativeBranchReads | undefined;
  /** The Project's command environment. */
  readonly environment: Readonly<Record<string, string>>;
  /** Whether the session also gets the repository's own skills (spec §2.6). */
  readonly useProjectSkills: boolean;
  readonly projectSkillsOff: readonly string[];
  /**
   * What the person does in the Thread, such as planning the Task, added to their standing
   * instructions. The same for every session of the Thread, so it stays in the cached prefix.
   */
  readonly instructions: string;
  readonly officeTools: readonly string[];
  /**
   * The Task's record as a new session picks it up (spec §2.5): never a transcript. Undefined for a
   * later session of a person's Thread, which the Context policy briefs from the Thread alone.
   */
  readonly brief: string | undefined;
  /**
   * The person is only asked about the Task (spec §2.4): their session opens nothing that waits, so
   * it gets no tool a held call would need a Decision for.
   */
  readonly asking: boolean;
  /**
   * Why no session can work on the Task any more, such as once its worktree is removed, in the
   * UI's words. The Thread stays readable; a session is refused.
   */
  readonly sessionRefusal: string | undefined;
}

/** Sets up the sessions of Threads on Tasks. */
export interface TaskThreadSource {
  /**
   * Whoever holds Plans, whose tab comes first, by their Role's key; undefined while nobody does.
   */
  planner(): Promise<string | undefined>;
  setUp(thread: TaskThreadRequest): Promise<TaskThreadSetup>;
  /**
   * Readies the Task for a person's Thread to open on it, its worktree above all; why it can't
   * have one, in the UI's words.
   */
  readyForPersonsThread(taskId: string): Promise<string | undefined>;
  /**
   * The Initiative's planning Thread the Task is planned in, which counts as its planning Thread;
   * undefined while it is planned in none, or in one of its own.
   */
  planningThreadElsewhere(taskId: string): Promise<PlanningThreadElsewhere | undefined>;
}

/**
 * Where the module keeping Tasks gives Conversations what a Thread on a Task works with. That
 * module calls Conversations to open its Threads, so it registers here instead of being called
 * through a port: a module import each way would be a cycle (apps/service/docs/module-template.md).
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
    return this.registered().setUp(thread);
  }

  planner(): Promise<string | undefined> {
    return this.registered().planner();
  }

  readyForPersonsThread(taskId: string): Promise<string | undefined> {
    return this.registered().readyForPersonsThread(taskId);
  }

  planningThreadElsewhere(taskId: string): Promise<PlanningThreadElsewhere | undefined> {
    return this.registered().planningThreadElsewhere(taskId);
  }

  private registered(): TaskThreadSource {
    if (!this.source) throw new Error("No module sets up the sessions of Threads on Tasks.");
    return this.source;
  }
}
