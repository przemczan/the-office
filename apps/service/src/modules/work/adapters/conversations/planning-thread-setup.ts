import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  TaskThreadSetups,
  type TaskThreadRequest,
  type TaskThreadSetup,
  type TaskThreadSource,
} from "../../../conversations/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { TaskService } from "../../application/task-service.js";
import {
  PLANNING_INSTRUCTIONS,
  PLANNING_OFFICE_TOOLS,
  planningBrief,
} from "../../domain/planning.js";
import { KnownProjects } from "../../ports/known-projects.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";

/**
 * Sets up the sessions of Threads on Tasks for Conversations, from the Task's record. Every Thread
 * on a Task is a planning Thread until Stages run on Tasks.
 */
@Injectable()
export class PlanningThreadSetup implements TaskThreadSource, OnModuleInit {
  constructor(
    private readonly setups: TaskThreadSetups,
    private readonly tasks: TaskService,
    private readonly ideas: IdeaService,
    private readonly attachments: AttachmentService,
    private readonly projects: KnownProjects,
    private readonly worktrees: ProjectWorktrees,
  ) {}

  onModuleInit(): void {
    this.setups.provide(this);
  }

  async setUp({ taskId }: TaskThreadRequest): Promise<TaskThreadSetup> {
    const task = await this.tasks.read(taskId);
    const project = await this.projects.find(task.projectId);
    if (!project) throw new Error(`The Task ${task.id}'s Project ${task.projectId} is gone.`);
    const [worktree, idea, attachments] = await Promise.all([
      this.worktrees.find(task.projectId, task.id),
      task.originIdeaId === undefined ? undefined : this.ideas.read(task.originIdeaId),
      this.attachments.listOf({ kind: "task", taskId: task.id }),
    ]);
    return {
      folder: worktree.path,
      environment: worktree.environment,
      useProjectSkills: project.useProjectSkills,
      instructions: PLANNING_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      brief: planningBrief({ task, project, worktree, idea, attachments }),
    };
  }
}
