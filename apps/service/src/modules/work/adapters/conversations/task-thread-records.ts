import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
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
import { ASKING_INSTRUCTIONS, askingBrief } from "../../domain/asking.js";
import { PLANNER, PLANNING_INSTRUCTIONS, planningBrief } from "../../domain/planning.js";
import type { Task } from "../../domain/task.js";
import { KnownPipelines } from "../../ports/known-pipelines.js";
import { KnownProjects, type KnownProject } from "../../ports/known-projects.js";
import { ProjectWorktrees, type TaskWorktree } from "../../ports/project-worktrees.js";
import { StageResults } from "../../ports/stage-results.js";

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
  "write_tags",
  OPEN_DECISION_TOOL,
] as const;

/** The Office tools of a person's Thread on a Task: it reads records and changes none (spec §2.4). */
export const ASKING_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  "list_tasks",
  "read_task",
  "list_ideas",
  "read_idea",
  "read_attachment",
] as const;

/**
 * Sets up the sessions of Threads on Tasks for Conversations, from the Task's record: the Planner's
 * until the Task is Ready plans it; every other person's Thread only reads. A Stage's session is
 * set up by its Stage, and a Consultation's gets its own tools and instructions from Conversations.
 */
@Injectable()
export class TaskThreadRecords implements TaskThreadSource, OnModuleInit {
  readonly planner = PLANNER;
  private readonly logger = new Logger(TaskThreadRecords.name);

  constructor(
    private readonly setups: TaskThreadSetups,
    private readonly tasks: TaskService,
    private readonly ideas: IdeaService,
    private readonly attachments: AttachmentService,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly stageResults: StageResults,
  ) {}

  onModuleInit(): void {
    this.setups.provide(this);
  }

  async setUp(request: TaskThreadRequest): Promise<TaskThreadSetup> {
    const task = await this.tasks.read(request.taskId);
    const project = await this.projects.find(task.projectId);
    if (!project) throw new Error(`The Task ${task.id}'s Project ${task.projectId} is gone.`);
    return request.personsThread && !plansIt(task, request.roleKey)
      ? this.asking(request, task, project)
      : this.planning(task, project);
  }

  async readyForPersonsThread(taskId: string): Promise<string | undefined> {
    const task = await this.tasks.read(taskId);
    const ended = ENDED_TASK_CONVERSATION_WORDS[task.state];
    if (ended !== undefined) return ended;
    if (task.state === "backlog") return NOTHING_TO_ASK_IN_BACKLOG;
    // A Task marked Ready from Backlog has no worktree yet.
    await this.worktrees.open(task.projectId, task.id);
    return undefined;
  }

  private async asking(
    { roleKey, firstSession }: TaskThreadRequest,
    task: Task,
    project: KnownProject,
  ): Promise<TaskThreadSetup> {
    const worktree = await this.worktrees.find(task.projectId, task.id);
    const sessionRefusal = ENDED_TASK_CONVERSATION_WORDS[task.state];
    return {
      projectId: task.projectId,
      folder: worktree.path,
      environment: worktree.environment,
      useProjectSkills: project.useProjectSkills,
      projectSkillsOff: project.projectSkillsOff,
      instructions: ASKING_INSTRUCTIONS,
      officeTools: ASKING_OFFICE_TOOLS,
      brief: firstSession ? await this.record(roleKey, task, project, worktree) : undefined,
      asking: true,
      sessionRefusal,
    };
  }

  private async record(
    roleKey: string,
    task: Task,
    project: KnownProject,
    worktree: TaskWorktree,
  ): Promise<string> {
    const [attachments, { lines, handoverNotes }, diffSummary] = await Promise.all([
      this.attachments.listOf({ kind: "task", taskId: task.id }),
      this.stageResults.of(task.id, roleKey),
      this.changesOf(task),
    ]);
    return askingBrief({
      task,
      projectName: project.name,
      worktree,
      attachments,
      stageResults: lines,
      diffSummary,
      handoverNotes,
    });
  }

  /**
   * The diff, which every reading of a Thread with no session yet asks for: one that can't be read,
   * as with no worktree on disk, leaves the Brief without it and the Thread readable.
   */
  private async changesOf(task: Task): Promise<string | undefined> {
    // The worktree of a Task that ended is gone, and no session will read this Brief.
    if (ENDED_TASK_CONVERSATION_WORDS[task.state] !== undefined) return undefined;
    return this.worktrees.changesSoFar(task.projectId, task.id).catch((error: unknown) => {
      this.logger.warn(`Task ${task.id}'s changes couldn't be read: ${String(error)}`);
      return undefined;
    });
  }

  private async planning(task: Task, project: KnownProject): Promise<TaskThreadSetup> {
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
      projectSkillsOff: project.projectSkillsOff,
      instructions: PLANNING_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      brief: planningBrief({ task, project, worktree, idea, attachments, pipelines }),
      asking: false,
      sessionRefusal: ENDED_TASK_CONVERSATION_WORDS[task.state],
    };
  }
}

const NOTHING_TO_ASK_IN_BACKLOG =
  "This Task is in Backlog: nothing is written here until Make a plan or Plan with… starts Planning.";

/** The Planner plans until the Task is Ready, and again if a Save moves it to Backlog. */
function plansIt({ state }: Task, roleKey: string): boolean {
  return roleKey === PLANNER && (state === "backlog" || state === "planning");
}
