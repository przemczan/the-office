import { Injectable, type OnModuleInit } from "@nestjs/common";
import { IssueTasks, type NewIssueTask } from "../../../projects/index.js";
import { TaskService } from "../../application/task-service.js";
import { byTheUser } from "../../domain/author.js";
import { TaskRepository } from "../../ports/task-repository.js";

/**
 * Gives Projects where an issue's import creates its Task (docs/design/issues-as-tasks.html): a
 * Task in Backlog of the issue's Kind, its title, its body as the Description, Normal priority,
 * created by the user who imported it, or for the auto-import named as The Office's; and a Task's
 * Initiative's other Tasks, whose issues a Publishing Task's `Fixes #n` lines name. Work reads
 * Projects, so Projects can't ask Work directly.
 */
@Injectable()
export class ProjectsIssueTaskRegistration implements OnModuleInit {
  constructor(
    private readonly registry: IssueTasks,
    private readonly tasks: TaskService,
    private readonly repository: TaskRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      (task) => this.create(task),
      (taskId) => this.initiativeTasksOf(taskId),
    );
  }

  /** The other Tasks of the Task's Initiative; none for a Task of no Initiative, or none at all. */
  private async initiativeTasksOf(taskId: string): Promise<readonly string[]> {
    const task = await this.repository.find(taskId);
    const initiativeId = task?.initiativeId;
    if (initiativeId === undefined) return [];
    return (await this.repository.list())
      .filter((each) => each.initiativeId === initiativeId && each.id !== taskId)
      .map((each) => each.id);
  }

  /** The new Task's id; throws TaskRefused as Work refuses it. */
  private async create(issue: NewIssueTask): Promise<string> {
    const task = await this.tasks.create(
      {
        title: issue.title,
        description: issue.description,
        projectId: issue.projectId,
        priority: "normal",
        kind: issue.kind,
      },
      byTheUser({ userId: issue.createdBy.userId, name: issue.createdBy.name }),
      undefined,
      { createdByTheOffice: issue.createdByTheOffice },
    );
    return task.id;
  }
}
