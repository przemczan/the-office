import { Injectable } from "@nestjs/common";
import { attachmentLines } from "../domain/attachment.js";
import { linkedRecordsSection, type TaskLinks } from "../domain/linked-records.js";
import { taskRecordText } from "../domain/record-words.js";
import type { Task } from "../domain/task.js";
import { taskBranchBase } from "../domain/task-branch-base.js";
import { commitMessageOf } from "../domain/task-commit-message.js";
import { descriptionSection } from "../domain/task-description.js";
import { taskWhoAskedSection } from "../domain/who-asked.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { ProjectWorktrees, type TaskWorktree } from "../ports/project-worktrees.js";
import { StageResults } from "../ports/stage-results.js";
import { TaskDecisions } from "../ports/task-decisions.js";
import { AttachmentService } from "./attachment-service.js";
import { IdeaService } from "./idea-service.js";
import { InitiativeService } from "./initiative-service.js";
import { TaskService } from "./task-service.js";

/** A Task's record, as a session working on the Task reads it. */
export interface TaskRecord extends Pick<
  Task,
  "title" | "plan" | "definitionOfDone" | "initiativeId" | "engineStandIns"
> {
  /** The commit message Publish lands it as: the one written, or the default. */
  readonly commitMessage: { readonly text: string; readonly written: boolean };
  /** The Description, as the section of a Brief the Planner's has too. */
  readonly descriptionSection: string;
  /** Each of its Attachments, as a line of a Brief; none when it has none. */
  readonly attachmentLines: readonly string[];
  /**
   * The records it is linked to, as a section of a Brief, the same as the Planner's; none when it is
   * linked to none.
   */
  readonly linkedRecordsSection: string | undefined;
  /** Who created it and who started it, or queued it to start, as a section of a Brief. */
  readonly whoAskedSection: string;
  readonly project: Pick<
    KnownProject,
    | "id"
    | "name"
    | "baseBranch"
    | "installCommand"
    | "commands"
    | "useProjectSkills"
    | "projectSkillsOff"
    | "publishingMode"
  >;
  readonly worktree: TaskWorktree;
  /**
   * The Initiative's branch the Task starts from and publishes into, its Initiative having a
   * Pipeline (spec 5.5), or, for a Publishing Task, the one its worktree holds itself; undefined
   * for a Task of the base branch.
   */
  readonly initiativeBranch: string | undefined;
  /** Whether it is its Initiative's Publishing Task, which publishes that branch into the base. */
  readonly publishingTask: boolean;
}

/**
 * The Tasks' records: for the modules that brief sessions working on them, such as Pipelines, and as
 * an Agent reads one.
 */
@Injectable()
export class TaskRecords {
  constructor(
    private readonly tasks: TaskService,
    private readonly ideas: IdeaService,
    private readonly initiatives: InitiativeService,
    private readonly attachments: AttachmentService,
    private readonly stageResults: StageResults,
    private readonly projects: KnownProjects,
    private readonly worktrees: ProjectWorktrees,
    private readonly decisions: TaskDecisions,
  ) {}

  /**
   * Throws TaskNotFound when there is no such Task, and TaskRefused when its Initiative has a
   * Pipeline but no branch in its Project.
   */
  async read(taskId: string): Promise<TaskRecord> {
    const task = await this.tasks.read(taskId);
    const project = await this.projects.find(task.projectId);
    if (!project) throw new Error(`The Task ${task.id}'s Project ${task.projectId} is gone.`);
    const [attachments, links, worktree, stateChanges] = await Promise.all([
      this.attachments.listOf({ kind: "task", taskId }),
      this.linksOf(task),
      this.worktrees.find(task.projectId, taskId),
      this.tasks.stateChangesOf(taskId),
    ]);
    const base = taskBranchBase(task, links.initiative, project.id, project.name);
    return {
      title: task.title,
      descriptionSection: descriptionSection(task.description),
      plan: task.plan,
      definitionOfDone: task.definitionOfDone,
      initiativeId: task.initiativeId,
      engineStandIns: task.engineStandIns,
      commitMessage: { text: commitMessageOf(task), written: task.commitMessage !== "" },
      attachmentLines: attachments.length === 0 ? [] : attachmentLines(attachments),
      linkedRecordsSection: linkedRecordsSection(links),
      whoAskedSection: taskWhoAskedSection(task, stateChanges, "start"),
      project: {
        id: project.id,
        name: project.name,
        baseBranch: project.baseBranch,
        installCommand: project.installCommand,
        commands: project.commands,
        useProjectSkills: project.useProjectSkills,
        projectSkillsOff: project.projectSkillsOff,
        publishingMode: project.publishingMode,
      },
      worktree,
      initiativeBranch: base.kind === "base-branch" ? undefined : base.branch,
      publishingTask: base.kind === "publishing-task",
    };
  }

  /**
   * The Task's record as an Agent reads it, through `read_task` or mentioned in a chat. Throws
   * TaskNotFound when there is no such Task.
   */
  async recordText(taskId: string): Promise<string> {
    const task = await this.tasks.read(taskId);
    const [attachments, links, stageResults, stateChanges, decisionsWaiting] = await Promise.all([
      this.attachments.listOf({ kind: "task", taskId }),
      this.linksOf(task),
      this.stageResults.ofTask(taskId),
      this.tasks.stateChangesOf(taskId),
      this.decisions.waitingOnTheUserOn(taskId),
    ]);
    return taskRecordText(task, {
      attachments,
      links,
      stageResults,
      stateChanges,
      decisionsWaiting,
    });
  }

  /** The records the Task is linked to, archived and dropped ones too. */
  async linksOf(task: Task): Promise<TaskLinks> {
    const [dependencies, idea, initiative] = await Promise.all([
      this.tasks.dependenciesOf(task),
      task.originIdeaId === undefined ? undefined : this.ideas.read(task.originIdeaId),
      task.initiativeId === undefined ? undefined : this.initiatives.read(task.initiativeId),
    ]);
    return { ...dependencies, idea, initiative };
  }
}
