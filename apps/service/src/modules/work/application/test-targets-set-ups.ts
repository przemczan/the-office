import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import type { Author } from "../domain/author.js";
import { orderAfter } from "../domain/manual-order.js";
import { missingCommands, missingCommandsWords } from "../domain/pipeline-commands.js";
import type { Task } from "../domain/task.js";
import { TaskRefused } from "../domain/task-refused.js";
import {
  createTestTargetsSetUpTask,
  isOpenTestTargetsSetUp,
  SET_UP_TEST_TARGETS_PIPELINE,
} from "../domain/test-targets-set-up.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { KnownProjects } from "../ports/known-projects.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";

/** A Project's "Set up test targets" Task, at most one open at a time (spec §2.12). */
@Injectable()
export class TestTargetsSetUps {
  /** By Project, so two requests at once find the Task the first one adds. */
  private readonly locks = new KeyedLocks();

  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly events: EventBus,
  ) {}

  /** The Project's open set-up Task; undefined when it has none. */
  async openOf(projectId: string): Promise<Task | undefined> {
    return (await this.tasks.madeFor("test-targets-setup", projectId)).find(isOpenTestTargetsSetUp);
  }

  /**
   * The Project's open set-up Task, added now when it has none: Ready on "Set up test targets", in
   * a worktree of its own, since the Task skips Planning. The worktree is made once the Task is
   * kept, as Projects reads which branch it starts from through the Task; opening it again makes
   * only one that is missing, so asking again mends a failed first try. Refused when the Project
   * lacks a command that Pipeline runs, or the worktree can't be made.
   */
  async add(projectId: string, createdBy: Author): Promise<Task> {
    const task = await this.locks.run(
      projectId,
      async () => (await this.openOf(projectId)) ?? this.create(projectId, createdBy),
    );
    await this.worktrees.open(projectId, task.id).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The set-up Task's worktree couldn't be made: ${reason}`]);
    });
    return task;
  }

  private async create(projectId: string, createdBy: Author): Promise<Task> {
    const project = await this.projects.find(projectId);
    if (!project) throw new TaskRefused([`There is no Project "${projectId}".`]);
    const pipeline = await this.pipelines.commandsNamedBy(SET_UP_TEST_TARGETS_PIPELINE);
    if (!pipeline) {
      throw new TaskRefused(["The Pipeline library has no Set up test targets Pipeline."]);
    }
    const missing = missingCommands(pipeline, project);
    if (missing.length > 0) {
      throw new TaskRefused([missingCommandsWords(pipeline.name, missing, project.name)]);
    }
    const { task, event } = await this.tasks.create((takenOrders) =>
      createTestTargetsSetUpTask(
        randomUUID(),
        project,
        { order: orderAfter(takenOrders), createdBy },
        new Date(),
      ),
    );
    await this.events.publish(event);
    return task;
  }
}
