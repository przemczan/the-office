import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ENDED_TASK_CONVERSATION_WORDS, OPEN_DECISION_TOOL } from "@the-office/contracts";
import {
  TaskThreadSetups,
  type TaskThreadRequest,
  type TaskThreadSetup,
  type TaskThreadSource,
} from "../../../conversations/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { TaskService } from "../../application/task-service.js";
import { PLANNING_INSTRUCTIONS, planningBrief } from "../../domain/planning.js";
import { KnownPipelines } from "../../ports/known-pipelines.js";
import { KnownProjects } from "../../ports/known-projects.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";

/**
 * The Office tools of a planning session: it reads records and the Task's Attachments, writes the
 * Plan and the Definition of Done, proposes a Pipeline and opens Decisions.
 */
export const PLANNING_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  "list_tasks",
  "read_task",
  "list_ideas",
  "read_idea",
  "read_attachment",
  "write_plan",
  "write_definition_of_done",
  "propose_pipeline",
  OPEN_DECISION_TOOL,
] as const;

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
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
  ) {}

  onModuleInit(): void {
    this.setups.provide(this);
  }

  async setUp({ taskId }: TaskThreadRequest): Promise<TaskThreadSetup> {
    const task = await this.tasks.read(taskId);
    const project = await this.projects.find(task.projectId);
    if (!project) throw new Error(`The Task ${task.id}'s Project ${task.projectId} is gone.`);
    const [worktree, idea, attachments, pipelines] = await Promise.all([
      this.worktrees.find(task.projectId, task.id),
      task.originIdeaId === undefined ? undefined : this.ideas.read(task.originIdeaId),
      this.attachments.listOf({ kind: "task", taskId: task.id }),
      this.pipelines.list(),
    ]);
    return {
      projectId: task.projectId,
      folder: worktree.path,
      environment: worktree.environment,
      useProjectSkills: project.useProjectSkills,
      instructions: PLANNING_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      brief: planningBrief({ task, project, worktree, idea, attachments, pipelines }),
      sessionRefusal: ENDED_TASK_CONVERSATION_WORDS[task.state],
    };
  }
}
