import { Injectable, type OnModuleInit } from "@nestjs/common";
import { TaskBases, type TaskBase } from "../../../projects/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import { taskBranchBase } from "../../domain/task-branch-base.js";
import { KnownProjects } from "../../ports/known-projects.js";

/**
 * Gives Projects what each Task's branch starts from and publishes into, by its Initiative (spec
 * 5.5, "A worktree per Task"): Work reads Projects, so Projects can't ask Work directly.
 */
@Injectable()
export class ProjectsTaskBaseRegistration implements OnModuleInit {
  constructor(
    private readonly registry: TaskBases,
    private readonly tasks: TaskService,
    private readonly initiatives: InitiativeService,
    private readonly projects: KnownProjects,
  ) {}

  onModuleInit(): void {
    this.registry.register((projectId, taskId) => this.baseOf(projectId, taskId));
  }

  /** Throws TaskNotFound for no such Task, and TaskRefused when its Initiative's branch was never made. */
  private async baseOf(projectId: string, taskId: string): Promise<TaskBase> {
    const task = await this.tasks.read(taskId);
    if (task.initiativeId === undefined) return { kind: "base-branch" };
    const [initiative, project] = await Promise.all([
      this.initiatives.read(task.initiativeId),
      this.projects.find(projectId),
    ]);
    return taskBranchBase(initiative, projectId, project?.name ?? projectId);
  }
}
