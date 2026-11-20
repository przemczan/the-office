import { Injectable } from "@nestjs/common";
import type { IssueUser } from "../domain/issue-settings.js";
import type { TaskKind } from "../domain/kind-default-pipeline.js";

/** The Task an issue is imported as: its title, its body as the Description, and its Kind. */
export interface NewIssueTask {
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly kind: TaskKind;
  /** The user who imported it, or for the auto-import the user who set the label. */
  readonly createdBy: IssueUser;
  /** Whether The Office's auto-import made it, which the Task's record names as its creator. */
  readonly createdByTheOffice: boolean;
}

/** Creates the Task in Work and answers its id; throws as Work refuses it. */
export type IssueTaskCreator = (task: NewIssueTask) => Promise<string>;

/** The other Tasks of a Task's Initiative, by id; none for a Task of no Initiative. */
export type InitiativeTasksLookup = (taskId: string) => Promise<readonly string[]>;

/**
 * Where an issue's import creates its Task, and where a Publishing Task's Initiative's Tasks are
 * found for its `Fixes #n` lines, registered by Work as it starts: Work reads Projects, so
 * Projects can't ask it directly (the module template's registry, as TaskBases).
 */
@Injectable()
export class IssueTasks {
  private creator: IssueTaskCreator | undefined;
  private initiativeTasks: InitiativeTasksLookup | undefined;

  register(creator: IssueTaskCreator, initiativeTasks?: InitiativeTasksLookup): void {
    this.creator = creator;
    this.initiativeTasks = initiativeTasks;
  }

  /** The other Tasks of the Task's Initiative; none while nothing is registered. */
  async initiativeTasksOf(taskId: string): Promise<readonly string[]> {
    return this.initiativeTasks ? this.initiativeTasks(taskId) : [];
  }

  /** The new Task's id. Throws when nothing is registered. */
  async create(task: NewIssueTask): Promise<string> {
    if (!this.creator) throw new Error("No creator of a Task from an issue is registered.");
    return this.creator(task);
  }
}
