import { Injectable } from "@nestjs/common";
import { TaskWorktrees } from "../../../projects/index.js";
import { RunEnvironmentStart } from "../../ports/run-environment-start.js";

/** Projects starts it, as it knows the Task's worktree and what its image is made from. */
@Injectable()
export class ProjectsRunEnvironmentStart extends RunEnvironmentStart {
  constructor(private readonly worktrees: TaskWorktrees) {
    super();
  }

  start(taskId: string, projectId: string): Promise<readonly string[]> {
    return this.worktrees.startRunEnvironment(projectId, taskId);
  }
}
