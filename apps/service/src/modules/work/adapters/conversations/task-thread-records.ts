import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  ANSWER_DECISION_TOOL,
  CLOSED_TASK_CONVERSATION_WORDS,
  CONSULT_TOOL,
  OPEN_DECISION_TOOL,
} from "@the-office/contracts";
import {
  CALLING_RULE,
  TaskThreadSetups,
  type PlanningThreadElsewhere,
  type TaskThreadRequest,
  type TaskThreadSetup,
  type TaskThreadSource,
  PERSON_READING_OFFICE_TOOLS,
  READING_OFFICE_TOOLS,
} from "../../../conversations/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { ASKING_INSTRUCTIONS, askingBrief } from "../../domain/asking.js";
import { pipelineIn, type Initiative } from "../../domain/initiative.js";
import { PLANS } from "../../domain/duties.js";
import {
  PLANNING_INSTRUCTIONS,
  planningBrief,
  type InitiativeBranchStart,
  type PlanningPipeline,
} from "../../domain/planning.js";
import type { Task } from "../../domain/task.js";
import { taskBranchBase } from "../../domain/task-branch-base.js";
import { MOVED_AS_IT_OPENED } from "../../domain/task-move.js";
import { KnownPeople } from "../../ports/known-people.js";
import { KnownPipelines } from "../../ports/known-pipelines.js";
import { KnownProjects, type KnownProject } from "../../ports/known-projects.js";
import { ProjectWorktrees, type TaskWorktree } from "../../ports/project-worktrees.js";
import { StageResults } from "../../ports/stage-results.js";

/**
 * The Office tools of a planning session: it reads every record and Attachment, writes the Plan and
 * the Definition of Done onto its own Task, proposes a Pipeline, sets Tags, opens Decisions and
 * answers one for the user when they ask.
 */
export const PLANNING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  "write_plan",
  "write_definition_of_done",
  "propose_pipeline",
  "write_tags",
  "mark_planned",
  OPEN_DECISION_TOOL,
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
] as const;

/**
 * What whoever holds Plans does in the Planning Thread, calling a person only when the user asks.
 */
export const PLANNING_THREAD_INSTRUCTIONS = `${PLANNING_INSTRUCTIONS}\n\n${CALLING_RULE}`;

/** What a person does in their Thread on a Task, calling someone only when the user asks. */
export const ASKING_THREAD_INSTRUCTIONS = `${ASKING_INSTRUCTIONS}\n\n${CALLING_RULE}`;

/**
 * The Office tools of a person's Thread on a Task: it reads every record and Attachment, and the
 * Task's Stage history, and changes none but a Decision it answers for the user when they ask
 * (spec §2.4). It calls another person when the user asks (spec §2.2).
 */
export const ASKING_OFFICE_TOOLS = [
  ...PERSON_READING_OFFICE_TOOLS,
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
] as const;

/**
 * Sets up the sessions of Threads on Tasks for Conversations, from the Task's record: the Thread of
 * whoever holds Plans plans it until the Task starts; every other person's Thread only reads. A
 * Stage's session is set up by its Stage, and a Consultation's gets its own tools and instructions
 * from Conversations.
 */
@Injectable()
export class TaskThreadRecords implements TaskThreadSource, OnModuleInit {
  private readonly logger = new Logger(TaskThreadRecords.name);

  constructor(
    private readonly setups: TaskThreadSetups,
    private readonly tasks: TaskService,
    private readonly taskRecords: TaskRecords,
    private readonly attachments: AttachmentService,
    private readonly initiatives: InitiativeService,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly stageResults: StageResults,
    private readonly people: KnownPeople,
  ) {}

  onModuleInit(): void {
    this.setups.provide(this);
  }

  async setUp(request: TaskThreadRequest): Promise<TaskThreadSetup> {
    const task = await this.tasks.read(request.taskId);
    const project = await this.projects.find(task.projectId);
    if (!project) throw new Error(`The Task ${task.id}'s Project ${task.projectId} is gone.`);
    return request.personsThread && !plansIt(task, request.roleKey, await this.planner())
      ? this.asking(request, task, project)
      : this.planning(task, project);
  }

  planner(): Promise<string | undefined> {
    return this.people.holderOf(PLANS);
  }

  async readyForPersonsThread(taskId: string): Promise<string | undefined> {
    const task = await this.tasks.read(taskId);
    const closed = CLOSED_TASK_CONVERSATION_WORDS[task.state];
    if (closed !== undefined) return closed;
    if (task.state === "backlog") return NOTHING_TO_ASK_IN_BACKLOG;
    // A Task marked Ready from Backlog, or planned in its Initiative's Thread, has no worktree yet.
    await this.worktrees.open(task.projectId, task.id);
    // A Move landing meanwhile would leave the Thread in a Project where the Task has no worktree.
    if (!(await this.tasks.isInProject(task.id, task.projectId))) return MOVED_AS_IT_OPENED;
    return undefined;
  }

  async planningThreadElsewhere(taskId: string): Promise<PlanningThreadElsewhere | undefined> {
    const task = await this.tasks.read(taskId);
    if (!plannedInItsInitiative(task)) return undefined;
    return { initiativeId: task.initiativeId, threadId: task.initiativePlanningThreadId };
  }

  private async asking(
    { roleKey, firstSession }: TaskThreadRequest,
    task: Task,
    project: KnownProject,
  ): Promise<TaskThreadSetup> {
    const worktree = await this.worktrees.find(task.projectId, task.id);
    const sessionRefusal = CLOSED_TASK_CONVERSATION_WORDS[task.state];
    return {
      projectId: task.projectId,
      folder: worktree.path,
      environment: worktree.environment,
      useProjectSkills: project.useProjectSkills,
      projectSkillsOff: project.projectSkillsOff,
      instructions: ASKING_THREAD_INSTRUCTIONS,
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
    // No session will read this Brief, and the worktree of a Task that ended is gone.
    if (CLOSED_TASK_CONVERSATION_WORDS[task.state] !== undefined) return undefined;
    return this.worktrees.changesSoFar(task.projectId, task.id).catch((error: unknown) => {
      this.logger.warn(`Task ${task.id}'s changes couldn't be read: ${String(error)}`);
      return undefined;
    });
  }

  private async planning(task: Task, project: KnownProject): Promise<TaskThreadSetup> {
    const [worktree, links, attachments, pipelines, initiative] = await Promise.all([
      this.worktrees.find(task.projectId, task.id),
      this.taskRecords.linksOf(task),
      this.attachments.listOf({ kind: "task", taskId: task.id }),
      this.pipelines.listFor(task.projectId),
      task.initiativeId === undefined ? undefined : this.initiatives.record(task.initiativeId),
    ]);
    return {
      projectId: task.projectId,
      folder: worktree.path,
      environment: worktree.environment,
      useProjectSkills: project.useProjectSkills,
      projectSkillsOff: project.projectSkillsOff,
      instructions: PLANNING_THREAD_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      brief: planningBrief({
        task,
        project,
        worktree,
        links,
        attachments,
        pipelines,
        initiative,
        startsFrom: initiativeBranchStart(task, links.initiative, project, pipelines),
      }),
      asking: false,
      sessionRefusal: CLOSED_TASK_CONVERSATION_WORDS[task.state],
    };
  }
}

/**
 * The Initiative's branch the Task starts from, with its Initiative's Pipeline in the Task's
 * Project by name; undefined for the base branch.
 */
function initiativeBranchStart(
  task: Task,
  initiative: Initiative | undefined,
  project: KnownProject,
  pipelines: readonly PlanningPipeline[],
): InitiativeBranchStart | undefined {
  const base = taskBranchBase(task, initiative, project.id, project.name);
  const pipelineId = initiative && pipelineIn(initiative, task.projectId);
  if (base.kind !== "initiative-branch" || pipelineId === undefined) return undefined;
  const pipeline = pipelines.find(({ id }) => id === pipelineId);
  return {
    branch: base.branch,
    initiativePipeline: pipeline ? `${pipeline.name} (${pipelineId})` : pipelineId,
  };
}

const NOTHING_TO_ASK_IN_BACKLOG =
  "This Task is in Backlog: nothing is written here until Make a plan or Plan with… starts Planning.";

/**
 * In Planning in its Initiative's planning Thread (Plan the Initiative): it has no planning Thread
 * of its own, and no worktree, meanwhile.
 */
function plannedInItsInitiative(
  task: Task,
): task is Task & { readonly initiativeId: string; readonly initiativePlanningThreadId: string } {
  return (
    task.state === "planning" &&
    task.initiativeId !== undefined &&
    task.initiativePlanningThreadId !== undefined
  );
}

/**
 * Whoever holds Plans (`planner`) plans until the Task starts: in Ready too, where writing a part
 * takes it back to Planning (the user's words of 2026-11-11), and again if a Save moves it to
 * Backlog.
 */
function plansIt({ state }: Task, roleKey: string, planner: string | undefined): boolean {
  return roleKey === planner && ["shaping", "backlog", "planning", "ready"].includes(state);
}
