import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import type { Author } from "../domain/author.js";
import { orderAfter } from "../domain/manual-order.js";
import {
  isOpenOffBoardTask,
  newestMadeFirst,
  type OffBoardTask,
  type OffBoardTaskKind,
  type OffBoardTaskStart,
} from "../domain/off-board-task.js";
import { createOnboardTask, ONBOARD_PIPELINE } from "../domain/onboarding.js";
import { missingCommands, missingCommandsWords } from "../domain/pipeline-commands.js";
import {
  createRunEnvironmentSetUpTask,
  SET_UP_RUN_ENVIRONMENT_PIPELINE,
} from "../domain/run-environment-set-up.js";
import type { Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import { TaskDiscarded, type TaskCreated } from "../domain/task-events.js";
import type { MadeTaskSetting } from "../domain/task-made-for.js";
import { TaskRefused } from "../domain/task-refused.js";
import { startReasons } from "../domain/task-start.js";
import { STATES_A_START_WEIGHS } from "../domain/task-states.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";
import { OffBoardTaskReader } from "./off-board-task-reader.js";
import { StartConditionsReader } from "./start-conditions.js";
import { StartService } from "./start-service.js";

/** What each kind's Task is made with, and what it is called in a refusal. */
const MADE: Record<
  OffBoardTaskKind,
  {
    readonly words: string;
    readonly create: (
      id: string,
      project: KnownProject,
      setting: MadeTaskSetting,
      createdAt: Date,
    ) => TaskChange<TaskCreated>;
  }
> = {
  onboard: { words: "Onboard Task", create: createOnboardTask },
  "run-environment-setup": { words: "set-up Task", create: createRunEnvironmentSetUpTask },
};

/**
 * Makes and starts the Off-board Tasks (spec §2.1, "Off-board Tasks") in one call: the Task, Ready
 * on its Pipeline in a worktree of its own, goes through Start at once, so it starts, or is queued
 * with its place when the limits leave no room. A refused Start makes nothing: every refusal is
 * weighed before the Task is kept, and one met after (a worktree that couldn't be made, or a
 * refusal that came up meanwhile) takes it away again, with its worktree once it has one, and
 * `TaskDiscarded` tells whatever `TaskCreated` told. At most one of each kind is open per
 * Project, by a per-Project lock and a partial unique index; asking while one is answers it.
 */
@Injectable()
export class OffBoardTasks {
  private readonly logger = new Logger(OffBoardTasks.name);
  /** By kind and Project, so two requests at once find the Task the first one makes. */
  private readonly locks = new KeyedLocks();

  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly conditions: StartConditionsReader,
    private readonly fireAlarm: FireAlarmRepository,
    private readonly starting: StartService,
    private readonly reader: OffBoardTaskReader,
    private readonly events: EventBus,
  ) {}

  /** The Project's open one of the kind, the newest; undefined when it has none. */
  async openOf(kind: OffBoardTaskKind, projectId: string): Promise<Task | undefined> {
    const made = await this.tasks.madeFor(kind, projectId);
    return newestMadeFirst(made).find((task) => isOpenOffBoardTask(task, kind));
  }

  /** The Project's latest one of the kind, open or ended; undefined when it never had one. */
  async latestOf(kind: OffBoardTaskKind, projectId: string): Promise<Task | undefined> {
    return newestMadeFirst(await this.tasks.madeFor(kind, projectId))[0];
  }

  /**
   * Makes the Project's Off-board Task of the kind and starts it, as `by` asked; the open one when
   * it has one. Throws only what isn't a refusal.
   */
  async start(kind: OffBoardTaskKind, projectId: string, by: Author): Promise<OffBoardTaskStart> {
    return this.locks.run(`${kind}/${projectId}`, async () => {
      const open = await this.openOf(kind, projectId);
      if (open) return { outcome: "in-flight", offBoardTask: await this.read(open) };
      try {
        const task = await this.makeAndStart(kind, projectId, by);
        return { outcome: "started", offBoardTask: await this.read(task) };
      } catch (error) {
        if (!(error instanceof TaskRefused)) throw error;
        return { outcome: "refused", reasons: error.reasons };
      }
    });
  }

  private async makeAndStart(kind: OffBoardTaskKind, projectId: string, by: Author): Promise<Task> {
    const project = await this.projects.find(projectId);
    if (!project) throw new TaskRefused([`There is no Project "${projectId}".`]);
    await this.refuseWithoutThePipeline(kind, project);
    const id = randomUUID();
    const createdAt = new Date();
    const make = (order: string) =>
      MADE[kind].create(id, project, { order, createdBy: by }, createdAt);
    await this.refuseWhatStartRefuses(make("").task);
    // Kept before its worktree is made, as Projects reads which branch it starts from through it.
    const { task, event } = await this.tasks.create((takenOrders) => make(orderAfter(takenOrders)));
    try {
      await this.worktrees.open(projectId, task.id);
    } catch (error) {
      await this.discard(task);
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The ${MADE[kind].words}'s worktree couldn't be made: ${reason}`]);
    }
    await this.events.publish(event);
    try {
      await this.starting.start(task.id, { onOverlap: "start-anyway" }, by);
    } catch (error) {
      if (error instanceof TaskRefused) await this.discardAnnounced(task);
      throw error;
    }
    return (await this.tasks.find(task.id)) ?? task;
  }

  /** Refused when the library lacks the kind's Pipeline, or the Project a command it runs. */
  private async refuseWithoutThePipeline(
    kind: OffBoardTaskKind,
    project: KnownProject,
  ): Promise<void> {
    if (kind === "onboard") {
      if (!(await this.pipelines.find(ONBOARD_PIPELINE))) {
        throw new TaskRefused(["The Pipeline library has no Onboard Pipeline."]);
      }
      return;
    }
    const pipeline = await this.pipelines.commandsNamedBy(SET_UP_RUN_ENVIRONMENT_PIPELINE);
    if (!pipeline) {
      throw new TaskRefused(["The Pipeline library has no Set up run environment Pipeline."]);
    }
    const missing = missingCommands(pipeline, project);
    if (missing.length > 0) {
      throw new TaskRefused([missingCommandsWords(pipeline.name, missing, project.name)]);
    }
  }

  /**
   * What Start would refuse the Task for, weighed before it is kept, so a refusal makes nothing;
   * what would only hold it queues it once made. It names no files to change, so it overlaps no
   * started Task, and Start starts it past any Overlap all the same.
   */
  private async refuseWhatStartRefuses(draft: Task): Promise<void> {
    const [startedTasks, conditions, alarm] = await Promise.all([
      this.tasks.summariesIn(STATES_A_START_WEIGHS),
      this.conditions.of(draft),
      this.fireAlarm.read(),
    ]);
    const { refusals } = startReasons(draft, conditions, {
      startedTasks,
      blockers: [],
      fireAlarmOn: alarm.on,
      initiativePaused: false,
    });
    if (refusals.length > 0) throw new TaskRefused([...refusals]);
  }

  /** Takes away a Task just made whose start was refused, so nothing is left of it; whether it did. */
  private async discard(task: Task): Promise<boolean> {
    const discarded = await this.tasks.discardNeverStarted(task.id).catch((error: unknown) => {
      this.logger.error(`The refused ${task.title} Task ${task.id} wasn't taken away.`, error);
      return false;
    });
    if (!discarded) this.logger.warn(`The refused ${task.title} Task ${task.id} is left Ready.`);
    return discarded;
  }

  /**
   * Takes away a Task whose `TaskCreated` was told and whose worktree was made, as its Start was
   * refused after all: the worktree goes too, and `TaskDiscarded` is told. A Task left Ready keeps
   * its worktree, as a later Start works in it.
   */
  private async discardAnnounced(task: Task): Promise<void> {
    if (!(await this.discard(task))) return;
    await this.worktrees.removeWorktree(task.projectId, task.id).catch((error: unknown) => {
      this.logger.error(
        `The refused ${task.title} Task ${task.id}'s worktree wasn't removed.`,
        error,
      );
    });
    await this.events.publish(new TaskDiscarded(task.id, task.projectId));
  }

  private async read(task: Task): Promise<OffBoardTask> {
    const [read] = await this.reader.readAll([task]);
    if (!read) throw new Error(`The Task ${task.id} isn't an Off-board Task.`);
    return read;
  }
}
