import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
import { PLANNER, PLANNING_OPENING, PLANNING_THREAD_TITLE } from "../domain/planning.js";
import type { Task } from "../domain/task.js";
import { changeTaskState } from "../domain/task-changes.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { TaskRefused } from "../domain/task-refused.js";
import { stateChangeProblems } from "../domain/task-states.js";
import { KnownPeople } from "../ports/known-people.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskThreads } from "../ports/task-threads.js";
import { IdeaService } from "./idea-service.js";

/**
 * Planning a Task as a conversation with the Planner (spec §2.1): its own worktree on the freshly
 * fetched base branch, and a planning Thread where the Planner starts at once.
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly ideas: IdeaService,
    private readonly people: KnownPeople,
    private readonly worktrees: ProjectWorktrees,
    private readonly threads: TaskThreads,
    private readonly events: EventBus,
  ) {}

  /**
   * Backlog → Planning: the Task's branch and worktree, then its planning Thread with the Planner.
   * A Task in Planning already stays as it is, with its Thread; refused with the reason from any
   * other state, or while nobody is the Planner.
   */
  async plan(taskId: string): Promise<Task> {
    const task = await this.tasks.find(taskId);
    if (!task) throw new TaskNotFound(taskId);
    if (task.state === "planning") return task;
    const problems = stateChangeProblems(task, "planning");
    if (problems.length > 0) throw new TaskRefused(problems);
    await this.refuseWithoutPlanner();
    // The worktree first: a Task whose worktree couldn't be made stays in Backlog.
    await this.worktrees.open(task.projectId, task.id).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The Task's worktree couldn't be made: ${reason}`]);
    });
    const { task: planning, event } = await this.tasks.update(taskId, (latest) =>
      changeTaskState(latest, "planning"),
    );
    // Another call moved it first, and opened its Thread.
    if (!event) return planning;
    await this.events.publish(event);
    await this.threads.startOnTask({
      taskId,
      roleKey: PLANNER,
      title: PLANNING_THREAD_TITLE,
      opening: PLANNING_OPENING,
    });
    return planning;
  }

  /** Shapes the Idea into a Task in the Project and plans it at once. */
  async shapeAndPlan(ideaId: string, projectId: string, shapedBy: Author): Promise<Task> {
    await this.refuseWithoutPlanner();
    const task = await this.ideas.shape(ideaId, projectId, shapedBy);
    return this.plan(task.id);
  }

  private async refuseWithoutPlanner(): Promise<void> {
    if (!(await this.people.find(PLANNER))) {
      throw new TaskRefused([
        "Hire a Planner on People first: planning is a conversation with them.",
      ]);
    }
  }
}
