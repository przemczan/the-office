import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import type { Author } from "../domain/author.js";
import {
  createConflictResolutionTask,
  isOpenConflictResolution,
  RESOLVE_CONFLICTS_PIPELINE,
} from "../domain/conflict-resolution.js";
import { orderAfter } from "../domain/manual-order.js";
import { missingCommands, missingCommandsWords } from "../domain/pipeline-commands.js";
import type { Task } from "../domain/task.js";
import { TaskRefused } from "../domain/task-refused.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { KnownProjects } from "../ports/known-projects.js";
import { ProjectWorktrees, type TaskBranchCheckout } from "../ports/project-worktrees.js";
import { TaskPullRequests, type TaskPullRequest } from "../ports/task-pull-requests.js";
import { TaskRepository } from "../ports/task-repository.js";
import { StartService } from "./start-service.js";
import { TaskService } from "./task-service.js";

/** What Resolve conflicts did: the Conflict resolution Task, and why its Start was refused, if it was. */
export interface ConflictResolution {
  readonly task: Task;
  /** Every reason Start refused it, the Task left Ready; undefined when it started or queued, or was open already. */
  readonly startRefusal: readonly string[] | undefined;
}

/**
 * The Conflict resolution Tasks: one made for a Task's pull request with conflicts, on the
 * "Resolve conflicts" Pipeline, holding the pull request's branch, and started at once. At most one
 * is open per Task.
 */
@Injectable()
export class ConflictResolutions {
  /** By the Task whose pull request it is, so two presses at once find the Task the first adds. */
  private readonly locks = new KeyedLocks();

  constructor(
    private readonly tasks: TaskService,
    private readonly repository: TaskRepository,
    private readonly pullRequests: TaskPullRequests,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly starting: StartService,
    private readonly events: EventBus,
  ) {}

  /** The open Conflict resolution Task of the Task's pull request; undefined when it has none. */
  async openOf(taskId: string): Promise<Task | undefined> {
    return (await this.repository.linkedTo(taskId)).find(
      (task) => task.resolvesTaskId === taskId && isOpenConflictResolution(task),
    );
  }

  /**
   * Resolve conflicts on the pull request the Task opened: its open Conflict resolution Task when
   * it has one, else one made now and started. Throws TaskNotFound for no such Task, and
   * TaskRefused when the pull request has no conflicts to resolve, or the Task can't be made.
   */
  async resolve(taskId: string, by: Author): Promise<ConflictResolution> {
    const { open, made } = await this.locks.run(taskId, async () => {
      const openOne = await this.openOf(taskId);
      if (openOne) return { open: openOne, made: undefined };
      const original = await this.tasks.read(taskId);
      const pullRequest = await this.conflictingPullRequestOf(original);
      await this.refuseWithoutTheCommands(pullRequest.projectId);
      refuseWhileCheckedOut(
        original,
        await this.worktrees.checkoutOfBranch(pullRequest.projectId, original.id),
      );
      const { task, event } = await this.repository.create((takenOrders) =>
        createConflictResolutionTask(
          randomUUID(),
          original,
          pullRequest,
          { order: orderAfter(takenOrders), createdBy: by },
          new Date(),
        ),
      );
      await this.events.publish(event);
      return { open: undefined, made: task };
    });
    if (!made) return { task: open, startRefusal: undefined };
    // Made once the Task is kept, as Projects reads which branch it holds from it.
    try {
      await this.worktrees.open(made.projectId, made.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        task: made,
        startRefusal: [`The Conflict resolution Task's worktree couldn't be made: ${reason}`],
      };
    }
    try {
      const starting = await this.starting.start(made.id, { onOverlap: undefined }, by);
      return {
        task: starting.kind === "started" ? starting.change.task : await this.tasks.read(made.id),
        startRefusal: undefined,
      };
    } catch (error) {
      if (!(error instanceof TaskRefused)) throw error;
      return { task: await this.tasks.read(made.id), startRefusal: error.reasons };
    }
  }

  /** The Task's open pull request, refused unless it has conflicts. */
  private async conflictingPullRequestOf(original: Task): Promise<TaskPullRequest> {
    const pullRequest = await this.pullRequests.openOf(original.id);
    if (!pullRequest) throw new TaskRefused([`${original.title} has no open pull request.`]);
    if (pullRequest.mergeable === "yes") {
      throw new TaskRefused([
        `${original.title}'s pull request #${pullRequest.number} has no conflicts to resolve.`,
      ]);
    }
    if (pullRequest.mergeable === "unknown") {
      throw new TaskRefused([
        `The Office hasn't worked out yet whether ${original.title}'s pull request #${pullRequest.number} has conflicts. Try again in a minute.`,
      ]);
    }
    return pullRequest;
  }

  /** Refused when the library lacks the Pipeline, or the Project a command it runs. */
  private async refuseWithoutTheCommands(projectId: string): Promise<void> {
    const project = await this.projects.find(projectId);
    if (!project) throw new TaskRefused([`There is no Project "${projectId}".`]);
    const pipeline = await this.pipelines.commandsNamedBy(RESOLVE_CONFLICTS_PIPELINE);
    if (!pipeline) {
      throw new TaskRefused(["The Pipeline library has no Resolve conflicts Pipeline."]);
    }
    const setCommands = project.commands.filter(({ commandLine }) => commandLine.trim() !== "");
    const missing = missingCommands(pipeline, { commands: setCommands });
    if (missing.length > 0) {
      throw new TaskRefused([missingCommandsWords(pipeline.name, missing, project.name)]);
    }
  }
}

/** A worktree holds a branch only while no other has it checked out. */
function refuseWhileCheckedOut(original: Task, checkout: TaskBranchCheckout): void {
  const { branch, checkedOutIn, inTasksOwnWorktree } = checkout;
  if (checkedOutIn === undefined) return;
  if (inTasksOwnWorktree) {
    throw new TaskRefused([
      `The branch ${branch} is still checked out in ${original.title}'s own worktree (${checkedOutIn}), so a Conflict resolution Task can't hold it. Publish removes that worktree once the pull request is open; remove the one left over (git worktree remove ${checkedOutIn}), then press Resolve conflicts again.`,
    ]);
  }
  throw new TaskRefused([
    `The branch ${branch} is checked out in ${checkedOutIn}, so a Conflict resolution Task can't hold it. Switch that checkout to another branch, then press Resolve conflicts again.`,
  ]);
}
