import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
import { PLANNER, PLANNING_OPENING, PLANNING_THREAD_TITLE } from "../domain/planning.js";
import {
  confirmDefinitionOfDone,
  confirmPipeline,
  confirmPlan,
  proposeDefinitionOfDone,
  proposePipeline,
  proposePlan,
} from "../domain/planning-changes.js";
import type { ProposedPipeline, Task } from "../domain/task.js";
import {
  changeTaskState,
  markTaskReady,
  undoPlanningMove,
  type TaskChange,
} from "../domain/task-changes.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { TaskRefused } from "../domain/task-refused.js";
import { readinessLines, stateChangeProblems, type ReadinessLine } from "../domain/task-states.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskDecisions } from "../ports/task-decisions.js";
import { TaskThreads } from "../ports/task-threads.js";
import { IdeaService } from "./idea-service.js";

/**
 * Planning a Task as a conversation with the Planner (spec §2.1): its own worktree on the freshly
 * fetched base branch, and a planning Thread where the Planner starts at once. The Planner
 * proposes the Plan, the Definition of Done and a Pipeline; the user confirms them and marks the
 * Task Ready.
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly ideas: IdeaService,
    private readonly people: KnownPeople,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly threads: TaskThreads,
    private readonly decisions: TaskDecisions,
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
    await this.openPlanningThread(taskId);
    return planning;
  }

  /**
   * The Task's planning Thread with the Planner; when it can't be opened, the move to Planning is
   * undone and refused with the reason, so a Task is never in Planning without its Thread.
   */
  private async openPlanningThread(taskId: string): Promise<void> {
    try {
      await this.threads.startOnTask({
        taskId,
        roleKey: PLANNER,
        title: PLANNING_THREAD_TITLE,
        opening: PLANNING_OPENING,
      });
    } catch (error) {
      const { event } = await this.tasks.update(taskId, undoPlanningMove);
      if (event) await this.events.publish(event);
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The planning Thread couldn't be opened: ${reason}`]);
    }
  }

  /** Shapes the Idea into a Task in the Project and plans it at once. */
  async shapeAndPlan(ideaId: string, projectId: string, shapedBy: Author): Promise<Task> {
    await this.refuseWithoutPlanner();
    const task = await this.ideas.shape(ideaId, projectId, shapedBy);
    return this.plan(task.id);
  }

  async proposePlan(taskId: string, plan: string): Promise<Task> {
    return this.update(taskId, (task) => proposePlan(task, plan));
  }

  /** The user's Plan, confirmed: the proposed one as it is, or their edit of it. */
  async confirmPlan(taskId: string, plan: string): Promise<Task> {
    return this.update(taskId, (task) => confirmPlan(task, plan));
  }

  async proposeDefinitionOfDone(taskId: string, statements: readonly string[]): Promise<Task> {
    return this.update(taskId, (task) => proposeDefinitionOfDone(task, statements));
  }

  /** The user's Definition of Done, confirmed: the proposed one as it is, or their edit of it. */
  async confirmDefinitionOfDone(taskId: string, statements: readonly string[]): Promise<Task> {
    return this.update(taskId, (task) => confirmDefinitionOfDone(task, statements));
  }

  async proposePipeline(taskId: string, proposal: ProposedPipeline): Promise<Task> {
    await this.refuseUnknownPipeline(proposal.pipelineId);
    return this.update(taskId, (task) => proposePipeline(task, proposal));
  }

  /**
   * The user's Pipeline for the Task: the proposed one, or another from the library. The Task names
   * it by id only; Pipelines keeps a Task's own Stages, made when it starts or is edited for itself.
   */
  async confirmPipeline(taskId: string, pipelineId: string): Promise<Task> {
    await this.refuseUnknownPipeline(pipelineId);
    return this.update(taskId, (task) => confirmPipeline(task, pipelineId));
  }

  /**
   * Planning → Ready, refused with the reasons until the Plan and Definition of Done are confirmed,
   * the Pipeline proposal is answered and no Decision on the Task is open.
   */
  async markReady(taskId: string): Promise<Task> {
    const openDecisions = await this.decisions.openOn(taskId);
    return this.update(taskId, (task) => markTaskReady(task, openDecisions));
  }

  /** The conditions of Mark Ready and which are met, for the checklist beside the button. */
  async readiness(taskId: string): Promise<ReadinessLine[]> {
    const task = await this.tasks.find(taskId);
    if (!task) throw new TaskNotFound(taskId);
    return readinessLines(task, await this.decisions.openOn(taskId));
  }

  private async update<Event extends DomainEvent>(
    taskId: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<Task> {
    const { task, event } = await this.tasks.update(taskId, change);
    if (event) await this.events.publish(event);
    return task;
  }

  private async refuseUnknownPipeline(pipelineId: string): Promise<void> {
    if (await this.pipelines.find(pipelineId)) return;
    const known = (await this.pipelines.list()).map(({ id }) => id).join(", ");
    throw new TaskRefused([`There is no Pipeline "${pipelineId}". The library has ${known}.`]);
  }

  private async refuseWithoutPlanner(): Promise<void> {
    if (!(await this.people.find(PLANNER))) {
      throw new TaskRefused([
        "Hire a Planner on People first: planning is a conversation with them.",
      ]);
    }
  }
}
