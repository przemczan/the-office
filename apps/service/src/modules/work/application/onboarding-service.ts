import { Injectable } from "@nestjs/common";
import type { Author } from "../domain/author.js";
import type { OffBoardTaskStart } from "../domain/off-board-task.js";
import {
  latestOnboardingsOf,
  ONBOARD_PIPELINE,
  projectOnboardingOf,
  type ProjectOnboarding,
} from "../domain/onboarding.js";
import type { Task } from "../domain/task.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { TaskRepository } from "../ports/task-repository.js";
import { OffBoardTasks } from "./off-board-tasks.js";

/**
 * Onboarding a Project (spec §2.1 Defaults): its Onboard Task, an Off-board Task made and started
 * at once, and the onboarding read from its latest one.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly pipelines: KnownPipelines,
    private readonly offBoardTasks: OffBoardTasks,
  ) {}

  /** Every reason an Onboard Task can't be added now, besides its Project's own. */
  async problems(): Promise<string[]> {
    return (await this.pipelines.find(ONBOARD_PIPELINE))
      ? []
      : ["The Pipeline library has no Onboard Pipeline."];
  }

  /**
   * Onboard, and Onboard again once the latest Onboard Task is Done or Dropped: a new Onboard Task
   * made and started at once, or queued; the open one while there is one; refused with nothing made.
   */
  onboard(projectId: string, by: Author): Promise<OffBoardTaskStart> {
    return this.offBoardTasks.start("onboard", projectId, by);
  }

  /** The Project's Onboard Task still Ready, made before Off-board Tasks started at once. */
  async waitingOnboardTaskOf(projectId: string): Promise<Task | undefined> {
    return (await this.tasks.madeFor("onboard", projectId)).find((task) => task.state === "ready");
  }

  /** The Project's onboarding, from its latest Onboard Task; undefined when it has none. */
  async onboardingOf(projectId: string): Promise<ProjectOnboarding | undefined> {
    const latest = await this.offBoardTasks.latestOf("onboard", projectId);
    return latest && projectOnboardingOf(latest);
  }

  /** The onboarding of every Project that has one, from its latest Onboard Task. */
  async list(): Promise<ProjectOnboarding[]> {
    return latestOnboardingsOf(await this.tasks.madeFor("onboard"));
  }
}
