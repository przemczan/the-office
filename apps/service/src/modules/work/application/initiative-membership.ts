import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineReferenceLock } from "../../engine/index.js";
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
import {
  TaskInitiativeEngineOverrideChanged,
  type TaskAddedToInitiative,
  type TaskTakenOutOfInitiative,
} from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import { inheritedEngineMoves, inInitiative } from "../domain/work-engine.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";
import { InitiativeBranching } from "./initiative-branching.js";
import { TaskEngineChecks } from "./task-engine-checks.js";

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
    private readonly engineChecks: TaskEngineChecks,
    private readonly engineReferences: EngineReferenceLock,
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
    await this.refuseEngineMove(initiative, task, "joins");
    await this.branching.forNewProject(initiativeId, task.projectId);
    return this.change(initiativeId, taskId, "joins", async (held, heldTask, everyTask) =>
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
    return this.change(initiativeId, taskId, "leaves", async (held, heldTask, everyTask) =>
      takeOutOfInitiative(
        held,
        heldTask,
        everyTask,
        { worktreeExists: await this.worktreeExists(heldTask) },
        by,
      ),
    );
  }

  /**
   * Saves the join or the leave under Engine's `EngineReferenceLock`, so an engine's removal or a
   * change of the Initiative's engine override can't come in between the capability check, weighed on the
   * Initiative and the Task read again in the hold, and the write; the events are published after.
   */
  private async change<Event extends TaskAddedToInitiative | TaskTakenOutOfInitiative>(
    initiativeId: string,
    taskId: string,
    move: "joins" | "leaves",
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => Promise<InitiativeMembershipChange<Event> | undefined>,
  ): Promise<Task> {
    const { changed, initiative } = await this.engineReferences.holding(async () => {
      const [held, heldTask] = await Promise.all([
        this.initiative(initiativeId),
        this.task(taskId),
      ]);
      if (move === "joins" || heldTask.initiativeId === initiativeId) {
        await this.refuseEngineMove(held, heldTask, move);
      }
      const saved = await this.initiatives.changeMembership(initiativeId, taskId, change);
      return { changed: saved, initiative: saved && (await this.initiatives.find(initiativeId)) };
    });
    if (!changed) return this.task(taskId);
    const { task, publishing } = changed;
    const events: DomainEvent[] = [task.event];
    if (task.event.stateChanged) events.push(task.event.stateChanged);
    if (publishing) events.push(publishing.event);
    if (initiative?.engineOverride) {
      const inherited = task.task.initiativeId === initiativeId ? initiative.engineOverride : null;
      events.push(new TaskInitiativeEngineOverrideChanged(taskId, inherited));
    }
    for (const event of events) await this.events.publish(event);
    return task.task;
  }

  /**
   * Refuses the Task joining or leaving the Initiative with the capability check's reasons when
   * the Initiative's engine override, which applies while it has none of its own, would leave a
   * Role of its Pipeline on an engine that can't run it (spec 5.4.5). Nothing to check when the
   * Initiative has no override, or the Task has its own or is Done or Dropped.
   */
  private async refuseEngineMove(
    initiative: Initiative,
    task: Task,
    move: "joins" | "leaves",
  ): Promise<void> {
    const [before, after] =
      move === "joins" ? [null, initiative.engineOverride] : [initiative.engineOverride, null];
    const problems = await this.engineChecks.problemsOf({
      place: inInitiative(initiative),
      moves: inheritedEngineMoves([task], before, after),
    });
    if (problems.length > 0) throw new TaskRefused([...problems]);
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
