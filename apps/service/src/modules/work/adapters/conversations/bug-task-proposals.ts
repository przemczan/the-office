import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ProposalAppliers,
  ProposalRefused,
  type BugTaskFields,
  type CreatedBugTask,
} from "../../../conversations/index.js";
import { TaskService } from "../../application/task-service.js";
import type { UserRef } from "../../domain/author.js";
import { newTaskProblems, type NewTask } from "../../domain/task.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { TaskRefused } from "../../domain/task-refused.js";
import { KnownProjects } from "../../ports/known-projects.js";

/**
 * The Bug Tasks Agents propose from a Stage with propose_bug_task (spec §2.4): Work judges each as
 * proposed and creates it when the user answers Create the Bug Task: in Backlog, a Bug of normal
 * priority, created by The Office for the user who answered, found while working on the Agent's
 * Task. Work fills Conversations' registry itself, since Work calls Conversations.
 */
@Injectable()
export class BugTaskProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly tasks: TaskService,
    private readonly projects: KnownProjects,
  ) {}

  onModuleInit(): void {
    this.appliers.registerBugTask({
      projectOf: async (taskId) => (await this.tasks.find(taskId))?.projectId,
      problemsWith: (task) => this.problemsWith(task),
      create: (task, foundWhileWorkingOn, createdBy) =>
        this.create(task, foundWhileWorkingOn, createdBy),
    });
  }

  private async problemsWith(task: BugTaskFields): Promise<string[]> {
    const causedBy = task.causedBy ?? undefined;
    return [
      ...newTaskProblems(newBugTask(task)),
      ...((await this.projects.find(task.projectId))
        ? []
        : [`There is no Project "${task.projectId}".`]),
      ...(causedBy === undefined || (await this.tasks.find(causedBy))
        ? []
        : [`There is no Task ${causedBy} to have caused it.`]),
    ];
  }

  /** A refusal creates nothing and leaves the Decision open, in the words Work refuses with. */
  private async create(
    task: BugTaskFields,
    foundWhileWorkingOn: string,
    createdBy: UserRef | null,
  ): Promise<CreatedBugTask> {
    const causedBy = task.causedBy ?? undefined;
    try {
      const created = await this.tasks.create(
        newBugTask(task),
        { kind: "user", user: createdBy },
        undefined,
        {
          createdByTheOffice: true,
          foundWhileWorkingOn,
          ...(causedBy === undefined ? {} : { causedBy }),
        },
      );
      return { id: created.id, title: created.title };
    } catch (error) {
      if (error instanceof TaskRefused) throw new ProposalRefused(error.reasons);
      if (error instanceof TaskNotFound) throw new ProposalRefused([error.message]);
      throw error;
    }
  }
}

function newBugTask({ title, description, projectId }: BugTaskFields): NewTask {
  return { title, description, projectId, priority: "normal", kind: "bug" };
}
