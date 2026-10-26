import { Controller, Get, Param, ParseUUIDPipe, UseFilters } from "@nestjs/common";
import type { TaskChanges as TaskChangesResponse } from "@the-office/contracts";
import { TaskWorktrees } from "../../application/task-worktrees.js";
import type { TaskChanges } from "../../application/worktrees.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/** What a Task's commits changed in its Project, for the Changes tab and a Gate. */
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
}

function toTaskChangesResponse(changes: TaskChanges): TaskChangesResponse {
  return {
    worktreePath: changes.worktreePath ?? null,
    files: changes.files.map(({ path, previousPath, lines }) => ({
      path,
      previousPath: previousPath ?? null,
      lines: lines ? { added: lines.added, removed: lines.removed } : null,
    })),
    diff: changes.diff,
    diffCut: changes.diffCut,
  };
}
