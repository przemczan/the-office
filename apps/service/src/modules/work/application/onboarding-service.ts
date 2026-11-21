import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
import { orderAfter } from "../domain/manual-order.js";
import {
  createOnboardTask,
  ONBOARD_PIPELINE,
  projectOnboardingOf,
  type ProjectOnboarding,
} from "../domain/onboarding.js";
import type { Task } from "../domain/task.js";
import { TaskRefused } from "../domain/task-refused.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { KnownProjects } from "../ports/known-projects.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";

/** Onboarding a Project (spec §2.1 Defaults): its Onboard Task, and the onboarding read from it. */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly events: EventBus,
  ) {}

  /** Every reason an Onboard Task can't be added now, besides its Project's own. */
  async problems(): Promise<string[]> {
    return (await this.pipelines.find(ONBOARD_PIPELINE))
      ? []
      : ["The Pipeline library has no Onboard Pipeline."];
  }

  /**
   * Adds the Project's Onboard Task, Ready on Onboard, in a worktree of its own made now, since
   * the Task skips Planning, where a Task's worktree is otherwise made. The worktree is made once
   * the Task is kept, as Projects reads which branch it starts from through the Task; a Task whose
   * worktree couldn't be made is taken again, and opening it again makes only the missing worktree.
   */
  async addOnboardTask(projectId: string, createdBy: Author): Promise<Task> {
    const task =
      (await this.waitingOnboardTaskOf(projectId)) ?? (await this.create(projectId, createdBy));
    await this.worktrees.open(projectId, task.id).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The Onboard Task's worktree couldn't be made: ${reason}`]);
    });
    return task;
  }

  /** The Project's Onboard Task still Ready, not started yet; undefined when it has none. */
  async waitingOnboardTaskOf(projectId: string): Promise<Task | undefined> {
    return (await this.tasks.list()).find(
      (task) =>
        task.projectId === projectId && task.madeFor === "onboard" && task.state === "ready",
    );
  }

  private async create(projectId: string, createdBy: Author): Promise<Task> {
    const project = await this.projects.find(projectId);
    if (!project) throw new TaskRefused([`There is no Project "${projectId}".`]);
    const problems = await this.problems();
    if (problems.length > 0) throw new TaskRefused(problems);
    const { task, event } = await this.tasks.create((takenOrders) =>
      createOnboardTask(
        randomUUID(),
        project,
        { order: orderAfter(takenOrders), createdBy },
        new Date(),
      ),
    );
    await this.events.publish(event);
    return task;
  }

  /** The onboarding of every Project that has one; a Project not listed has none. */
  async list(): Promise<ProjectOnboarding[]> {
    return (await this.tasks.list()).flatMap((task) => projectOnboardingOf(task) ?? []);
  }
}
