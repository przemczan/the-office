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
   * the Task skips Planning, where a Task's worktree is otherwise made.
   */
  async addOnboardTask(projectId: string, createdBy: Author): Promise<Task> {
    const project = await this.projects.find(projectId);
    if (!project) throw new TaskRefused([`There is no Project "${projectId}".`]);
    const problems = await this.problems();
    if (problems.length > 0) throw new TaskRefused(problems);
    const id = randomUUID();
    await this.worktrees.open(projectId, id).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The Onboard Task's worktree couldn't be made: ${reason}`]);
    });
    const { task, event } = await this.tasks.create((takenOrders) =>
      createOnboardTask(id, project, { order: orderAfter(takenOrders), createdBy }, new Date()),
    );
    await this.events.publish(event);
    return task;
  }

  /** The onboarding of every Project that has one; a Project not listed has none. */
  async list(): Promise<ProjectOnboarding[]> {
    return (await this.tasks.list()).flatMap((task) => projectOnboardingOf(task) ?? []);
  }
}
