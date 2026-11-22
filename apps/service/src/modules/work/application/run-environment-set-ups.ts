import { Injectable } from "@nestjs/common";
import type { Author } from "../domain/author.js";
import type { OffBoardTaskStart } from "../domain/off-board-task.js";
import type { Task } from "../domain/task.js";
import { TaskRepository } from "../ports/task-repository.js";
import { OffBoardTasks } from "./off-board-tasks.js";

/** A Project's "Set up the run environment" Task, an Off-board Task, at most one open at a time. */
@Injectable()
export class RunEnvironmentSetUps {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly offBoardTasks: OffBoardTasks,
  ) {}

  /** The Project's open set-up Task; undefined when it has none. */
  openOf(projectId: string): Promise<Task | undefined> {
    return this.offBoardTasks.openOf("run-environment-setup", projectId);
  }

  /** Undefined when there is no such Task. */
  async find(taskId: string): Promise<Task | undefined> {
    return this.tasks.find(taskId);
  }

  /**
   * The Project's set-up Task made and started at once, or queued, on "Set up run environment" in a
   * worktree of its own; the open one when it has one. Refused, with nothing made, when the Project
   * lacks a command that Pipeline runs, Start refuses it, or the worktree can't be made.
   */
  add(projectId: string, createdBy: Author): Promise<OffBoardTaskStart> {
    return this.offBoardTasks.start("run-environment-setup", projectId, createdBy);
  }
}
