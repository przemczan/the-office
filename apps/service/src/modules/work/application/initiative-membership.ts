import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
import type { Initiative } from "../domain/initiative.js";
import {
  addToInitiative,
  takeOutOfInitiative,
  type InitiativeMembershipChange,
} from "../domain/initiative-membership.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import type { Task } from "../domain/task.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import type { TaskAddedToInitiative, TaskTakenOutOfInitiative } from "../domain/task-events.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";
import { InitiativeBranching } from "./initiative-branching.js";

/**
 * An existing Task joins an Initiative or leaves it (spec 2.1, "Initiatives"), by the user's click
 * or a person's Office action alike, straight onto it whether it is being shaped or active: the
 * person's Role authority is the gate, never a Proposal. Each change is saved first and its events
 * published after.
 */
@Injectable()
export class InitiativeMembership {
  constructor(
    private readonly initiatives: InitiativeRepository,
    private readonly tasks: TaskRepository,
    private readonly branching: InitiativeBranching,
    private readonly worktrees: ProjectWorktrees,
    private readonly events: EventBus,
  ) {}

  /**
   * The Task joins the Initiative. Its rules are judged before the Initiative's branch is made in a
   * Project it doesn't span yet, then again holding both, with the worktree read in the hold.
   */
  async add(initiativeId: string, taskId: string, by: Author): Promise<Task> {
    const [initiative, task] = await Promise.all([
      this.initiative(initiativeId),
      this.task(taskId),
    ]);
    const grounds = { worktreeExists: await this.worktreeExists(task) };
    // Every Task: the Publishing Task's new dependency is checked for a cycle across the board.
    addToInitiative(initiative, task, await this.tasks.list(), grounds, by);
    await this.branching.forNewProject(initiativeId, task.projectId);
    return this.change(initiativeId, taskId, async (held, heldTask, everyTask) =>
      addToInitiative(
        held,
        heldTask,
        everyTask,
        { worktreeExists: await this.worktreeExists(heldTask) },
        by,
      ),
    );
  }

  /** The Task leaves the Initiative, judged holding both, with the worktree read in the hold. */
  async takeOut(initiativeId: string, taskId: string, by: Author): Promise<Task> {
    return this.change(initiativeId, taskId, async (held, heldTask, everyTask) =>
      takeOutOfInitiative(
        held,
        heldTask,
        everyTask,
        { worktreeExists: await this.worktreeExists(heldTask) },
        by,
      ),
    );
  }

  private async change<Event extends TaskAddedToInitiative | TaskTakenOutOfInitiative>(
    initiativeId: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => Promise<InitiativeMembershipChange<Event> | undefined>,
  ): Promise<Task> {
    const changed = await this.initiatives.changeMembership(initiativeId, taskId, change);
    if (!changed) return this.task(taskId);
    const { task, publishing } = changed;
    const events: DomainEvent[] = [task.event];
    if (task.event.stateChanged) events.push(task.event.stateChanged);
    if (publishing) events.push(publishing.event);
    for (const event of events) await this.events.publish(event);
    return task.task;
  }

  private async initiative(id: string): Promise<Initiative> {
    const initiative = await this.initiatives.find(id);
    if (!initiative) throw new InitiativeNotFound(id);
    return initiative;
  }

  private async task(id: string): Promise<Task> {
    const task = await this.tasks.find(id);
    if (!task) throw new TaskNotFound(id);
    return task;
  }

  private worktreeExists(task: Task): Promise<boolean> {
    return this.worktrees.exists(task.projectId, task.id);
  }
}
