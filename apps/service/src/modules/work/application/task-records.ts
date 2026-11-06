import { Injectable } from "@nestjs/common";
import { attachmentLines } from "../domain/attachment.js";
import { taskRecordText } from "../domain/record-words.js";
import type { Task } from "../domain/task.js";
import { descriptionSection } from "../domain/task-description.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { ProjectWorktrees, type TaskWorktree } from "../ports/project-worktrees.js";
import { AttachmentService } from "./attachment-service.js";
import { TaskService } from "./task-service.js";

/** A Task's record, as a session working on the Task reads it. */
export interface TaskRecord extends Pick<Task, "title" | "plan" | "definitionOfDone"> {
  /** The Description, as the section of a Brief the Planner's has too. */
  readonly descriptionSection: string;
  /** Each of its Attachments, as a line of a Brief; none when it has none. */
  readonly attachmentLines: readonly string[];
  readonly project: Pick<
    KnownProject,
    "id" | "name" | "baseBranch" | "commands" | "useProjectSkills" | "projectSkillsOff"
  >;
  readonly worktree: TaskWorktree;
}

/**
 * The Tasks' records: for the modules that brief sessions working on them, such as Pipelines, and as
 * an Agent reads one.
 */
@Injectable()
export class TaskRecords {
  constructor(
    private readonly tasks: TaskService,
    private readonly attachments: AttachmentService,
    private readonly projects: KnownProjects,
    private readonly worktrees: ProjectWorktrees,
  ) {}

  /** Throws TaskNotFound when there is no such Task. */
  async read(taskId: string): Promise<TaskRecord> {
    const task = await this.tasks.read(taskId);
    const project = await this.projects.find(task.projectId);
    if (!project) throw new Error(`The Task ${task.id}'s Project ${task.projectId} is gone.`);
    const [attachments, worktree] = await Promise.all([
      this.attachments.listOf({ kind: "task", taskId }),
      this.worktrees.find(task.projectId, taskId),
    ]);
    return {
      title: task.title,
      descriptionSection: descriptionSection(task.description),
      plan: task.plan,
      definitionOfDone: task.definitionOfDone,
      attachmentLines: attachments.length === 0 ? [] : attachmentLines(attachments),
      project: {
        id: project.id,
        name: project.name,
        baseBranch: project.baseBranch,
        commands: project.commands,
        useProjectSkills: project.useProjectSkills,
        projectSkillsOff: project.projectSkillsOff,
      },
      worktree,
    };
  }

  /**
   * The Task's record as an Agent reads it, through `read_task` or mentioned in a chat. Throws
   * TaskNotFound when there is no such Task.
   */
  async recordText(taskId: string): Promise<string> {
    const task = await this.tasks.read(taskId);
    const [attachments, blockers, stateChanges] = await Promise.all([
      this.attachments.listOf({ kind: "task", taskId }),
      this.tasks.blockersOf(task),
      this.tasks.stateChangesOf(taskId),
    ]);
    return taskRecordText(task, attachments, blockers, stateChanges);
  }
}
