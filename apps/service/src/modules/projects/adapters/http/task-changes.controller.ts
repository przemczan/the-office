import { Controller, Get, Param, ParseUUIDPipe, UseFilters } from "@nestjs/common";
import type { TaskChanges as TaskChangesResponse, TaskRunEnvironment } from "@the-office/contracts";
import { TaskWorktrees } from "../../application/task-worktrees.js";
import type { TaskChanges } from "../../application/worktrees.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/**
 * What a Task's commits changed in its Project, for the Changes tab and a Gate, and where its
 * commands run, for the Task page.
 */
@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class TaskChangesController {
  constructor(private readonly taskWorktrees: TaskWorktrees) {}

  @Get(":id/tasks/:taskId/changes")
  async read(
    @Param("id") id: string,
    @Param("taskId", ParseUUIDPipe) taskId: string,
  ): Promise<TaskChangesResponse> {
    return toTaskChangesResponse(await this.taskWorktrees.changes(id, taskId));
  }

  /** Whether its commands run in its run environment because its worktree carries the definition. */
  @Get(":id/tasks/:taskId/run-environment")
  async runEnvironment(
    @Param("id") id: string,
    @Param("taskId", ParseUUIDPipe) taskId: string,
  ): Promise<TaskRunEnvironment> {
    return {
      carriesDefinition: await this.taskWorktrees.runsInCarriedRunEnvironment(id, taskId),
    };
  }
}

function toTaskChangesResponse(changes: TaskChanges): TaskChangesResponse {
  return {
    worktreePath: changes.worktreePath ?? null,
    files: changes.files.map(({ path, previousPath, lines, deleted }) => ({
      path,
      previousPath: previousPath ?? null,
      lines: lines ? { added: lines.added, removed: lines.removed } : null,
      deleted,
    })),
    diff: changes.diff,
    diffCut: changes.diffCut,
  };
}
