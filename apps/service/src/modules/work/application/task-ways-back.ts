import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskLocks } from "./task-locks.js";
import type { Author } from "../domain/author.js";
import type { Initiative } from "../domain/initiative.js";
import { isInitiativePaused } from "../domain/initiative-pause.js";
import type { Task } from "../domain/task.js";
import {
  reopenTask,
  startTaskOver,
  wayBackTakenBy,
  type StartingOver,
  type TaskChange,
} from "../domain/task-changes.js";
import type { TaskReopened, TaskStartedOver } from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import {
  reopenProblems,
  startOverProblems,
  waysBackOf,
  type ReopenGrounds,
  type ReopenTo,
  type StartOverTo,
  type WaysBack,
} from "../domain/task-states.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { TaskRepository, type TaskUpdate } from "../ports/task-repository.js";
import { TaskService } from "./task-service.js";
import { TaskStartOvers } from "./task-start-overs.js";

/** The Task's ways back as the Task page offers them, with what Start over and Reopen… ask. */
export interface TaskWaysBackAnswer extends WaysBack {
  /** Whether the Task had started, so Start over and Reopen… ask about resetting its branch. */
  readonly started: boolean;
  /** The branch a reset takes its branch to: its Initiative's branch, else the base branch. */
  readonly resetTo: string;
}

/**
 * The user's Start over and Reopen… of a Task, and the ways back offered on it (spec 2.1.3, "Work
 * moves forward"; spec 2.4.5). Restart from… is Pipelines', which moves the Task through
 * `TaskService.restart`. Each runs under the Task's lock (`TaskLocks`), which Resume and Restart
 * from… take too, so no walk starts between the judging and the save: refused first by Work's rules
 * and then by Pipelines' (`StartOverWork.refusals`) before Pipelines starts the walk over and resets
 * the branch, and only then is the Task's move saved, judged again as it is held. Its events are
 * published once the lock is let go, so the walk they start holds none of it.
 */
@Injectable()
export class TaskWaysBack {
  constructor(
    private readonly tasks: TaskService,
    private readonly repository: TaskRepository,
    private readonly initiatives: InitiativeRepository,
    private readonly startOvers: TaskStartOvers,
    private readonly taskLocks: TaskLocks,
    private readonly events: EventBus,
  ) {}

  /** Each way back offered now or why not, whether the Task had started and where a reset goes. */
  async waysBack(id: string): Promise<TaskWaysBackAnswer> {
    const task = await this.tasks.read(id);
    const work = this.startOvers.registered;
    const weighsPipelines = task.state === "paused" || task.state === "dropped";
    const none = Promise.resolve([]);
    const [holds, grounds, hadStarted, resetTo, startOverRefusals, branchResetRefusals] =
      await Promise.all([
        this.tasks.wayBackHolds(task),
        this.reopenGrounds(task),
        work.hadStarted(id),
        work.resetTo(id),
        weighsPipelines ? work.refusals(id) : none,
        weighsPipelines ? work.branchResetRefusals(id) : none,
      ]);
    return {
      ...waysBackOf(task, {
        ...grounds,
        holds,
        startOverRefusals,
        branchResetRefusals,
        hadStarted,
      }),
      started: hadStarted,
      resetTo,
    };
  }

  /**
   * Start over: a Task Paused by the user's own Pause or Stop goes to Ready or Backlog (`to`), not
   * queued: to Ready, its Plan, Definition of Done and Pipeline kept as confirmed; to Backlog, to be
   * planned again. Pipelines leaves its Stage runs so far as history and, with `resetBranch`,
   * resets its branch, keeping the old head under a local ref. Refused while the fire alarm, its
   * engine's usage window or its paused Initiative holds it; the reset, once its work has left the
   * workstation.
   */
  async startOver(id: string, to: StartOverTo, resetBranch: boolean, by: Author): Promise<Task> {
    const { user, person } = wayBackTakenBy(by);
    const work = this.startOvers.registered;
    const { task: changed, event } = await this.taskLocks.run(id, async () => {
      const task = await this.tasks.read(id);
      refuse(startOverProblems(task, await this.tasks.wayBackHolds(task)));
      refuse(await work.refusals(id));
      if (resetBranch) refuse(await work.branchResetRefusals(id));
      const { resetTo, keptRef } = await work.startOver(id, { resetBranch, by: user });
      const startingOver: StartingOver = { resetBranch, resetTo, keptRef, user, person };
      // The alarm holds no Start over (a Ready Task doesn't walk); its Initiative is read as held.
      return this.change(task, (held, initiativePaused) =>
        startTaskOver(held, to, { initiativePaused, alarmHoldsResume: false }, startingOver),
      );
    });
    await this.publish(event);
    return changed;
  }

  /**
   * Reopen…: a Dropped Task goes to Backlog or Ready, an archived one Restored first. One that had
   * started is started over through Pipelines as Start over is, with the same choice of resetting
   * its branch, refused once its work has left the workstation. In an active Initiative,
   * it waits in front of its Project's Publishing Task again while that hasn't started.
   */
  async reopen(id: string, to: ReopenTo, resetBranch: boolean, by: Author): Promise<Task> {
    const { user, person } = wayBackTakenBy(by);
    const work = this.startOvers.registered;
    const { task: reopened, event } = await this.taskLocks.run(id, async () => {
      const task = await this.tasks.read(id);
      refuse(reopenProblems(task, to, await this.reopenGrounds(task)));
      let startedOver: StartingOver | undefined;
      if (await work.hadStarted(id)) {
        refuse(await work.refusals(id));
        if (resetBranch) refuse(await work.branchResetRefusals(id));
        const { resetTo, keptRef } = await work.startOver(id, { resetBranch, by: user });
        startedOver = { resetBranch, resetTo, keptRef, user, person };
      }
      const reopening = { user, person, at: new Date(), startedOver };
      return task.initiativeId === undefined
        ? this.repository.update(id, (held) =>
            reopenTask(held, to, { initiative: undefined, initiativeTasks: [] }, reopening),
          )
        : this.initiatives.changeTask(
            task.initiativeId,
            id,
            (initiative: Initiative, held, tasks) =>
              reopenTask(held, to, { initiative, initiativeTasks: tasks }, reopening),
          );
    });
    await this.publish(event);
    if (event && reopened.initiativeId !== undefined) {
      await this.tasks.blockPublishingTaskIn(reopened.initiativeId, reopened.projectId, id);
    }
    return reopened;
  }

  private async reopenGrounds(task: Task): Promise<ReopenGrounds> {
    if (task.initiativeId === undefined) return { initiative: undefined, initiativeTasks: [] };
    const [initiative, initiativeTasks] = await Promise.all([
      this.initiatives.find(task.initiativeId),
      this.repository.inInitiatives([task.initiativeId]),
    ]);
    return { initiative, initiativeTasks };
  }

  /** Holding its Initiative first, when it has one, so a Pause of it is read as it stays. */
  private async change<Event extends DomainEvent>(
    task: Task,
    change: (held: Task, initiativePaused: boolean) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    if (task.initiativeId === undefined) {
      return this.repository.update(task.id, (held) => change(held, false));
    }
    return this.initiatives.changeTask(task.initiativeId, task.id, (initiative, held) =>
      change(held, isInitiativePaused(initiative)),
    );
  }

  /** The Restore and the move first, as every listener reacts to them, then the way back itself. */
  private async publish(event: TaskStartedOver | TaskReopened | undefined): Promise<void> {
    if (!event) return;
    if ("restored" in event && event.restored) await this.events.publish(event.restored);
    await this.events.publish(event.stateChanged);
    await this.events.publish(event);
  }
}

function refuse(problems: readonly string[]): void {
  if (problems.length > 0) throw new TaskRefused([...problems]);
}
