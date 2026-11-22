import { Injectable } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import {
  isOffBoardTask,
  newestMadeFirst,
  OFF_BOARD_TASK_KINDS,
  offBoardTaskOf,
  projectOffBoardTasksOf,
  type OffBoardTask,
  type ProjectOffBoardTasks,
} from "../domain/off-board-task.js";
import { queueOrder } from "../domain/queue.js";
import type { Task } from "../domain/task.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { QueueRepository } from "../ports/queue-repository.js";
import { StageResults } from "../ports/stage-results.js";
import { TaskDecisions } from "../ports/task-decisions.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskTokens } from "../ports/task-tokens.js";

/**
 * The Off-board Tasks as the Project page, Activity and Needs you show them (spec §2.1,
 * "Off-board Tasks"): each with where it stands, its Stages, who works it and its tokens so far.
 */
@Injectable()
export class OffBoardTaskReader {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly queue: QueueRepository,
    private readonly pipelines: KnownPipelines,
    private readonly stageResults: StageResults,
    private readonly decisions: TaskDecisions,
    private readonly people: KnownPeople,
    private readonly tokens: TaskTokens,
  ) {}

  /** The Project's latest of each kind and its earlier Onboard Tasks, newest first. */
  async ofProject(projectId: string): Promise<ProjectOffBoardTasks> {
    const made = await Promise.all(
      OFF_BOARD_TASK_KINDS.map((kind) => this.tasks.madeFor(kind, projectId)),
    );
    return projectOffBoardTasksOf(await this.readAll(newestMadeFirst(made.flat())));
  }

  /** Undefined for no such Task, or one that isn't an Off-board Task. */
  async ofTask(taskId: string): Promise<OffBoardTask | undefined> {
    const task = await this.tasks.find(taskId);
    return task && isOffBoardTask(task) ? (await this.readAll([task]))[0] : undefined;
  }

  /** Every Off-board Task off the Archive, newest made first. */
  async listAll(): Promise<OffBoardTask[]> {
    const made = await Promise.all(OFF_BOARD_TASK_KINDS.map((kind) => this.tasks.madeFor(kind)));
    return this.readAll(
      newestMadeFirst(made.flat().filter(({ archivedAt }) => archivedAt === undefined)),
    );
  }

  /** Each of the Off-board Tasks, in their order; the queue, Pipelines and runs read once. */
  async readAll(tasks: readonly Task[]): Promise<OffBoardTask[]> {
    if (tasks.length === 0) return [];
    const [queue, outlines] = await Promise.all([
      this.queue.list(),
      this.stageResults.outlinesOf(tasks.map(({ id }) => id)),
    ]);
    const places = new Map(queueOrder(queue).map((queued, index) => [queued.taskId, index + 1]));
    const queued = new Map(queue.map((entry) => [entry.taskId, entry]));
    const pipelineStages = new Map<string, Promise<string[]>>();
    const stagesOf = (pipelineId: string | undefined) => {
      if (pipelineId === undefined) return Promise.resolve([]);
      const read =
        pipelineStages.get(pipelineId) ??
        this.pipelines.read(pipelineId).then((pipeline) => {
          return pipeline?.stages.map(({ name }) => name) ?? [];
        });
      pipelineStages.set(pipelineId, read);
      return read;
    };
    const names = new Map<string, Promise<string | undefined>>();
    const nameOf = (roleKey: string) => {
      const read =
        names.get(roleKey) ?? this.people.find(roleKey).then((person) => person?.card.name);
      names.set(roleKey, read);
      return read;
    };
    const read = await readEach(
      tasks.map((task, index) => ({ task, outline: outlines[index] })),
      async ({ task, outline }) => {
        const latestRoleKey = outline?.runs.at(-1)?.roleKey;
        const [stages, waitingOnTheUser, stateChanges, tokens, latestName] = await Promise.all([
          stagesOf(task.pipelineId),
          task.state === "waiting-on-you" ? this.decisions.waitingOnTheUserOn(task.id) : [],
          this.tasks.stateChangesOf(task.id),
          this.tokens.stageTokensSoFar(task.id),
          latestRoleKey === undefined ? undefined : nameOf(latestRoleKey),
        ]);
        const entry = queued.get(task.id);
        const place = places.get(task.id);
        return offBoardTaskOf(task, {
          queued:
            entry && place !== undefined
              ? { place, shortReasons: entry.shortReasons, queuedAt: entry.queuedAt }
              : undefined,
          ownStages: outline?.stages,
          pipelineStages: stages,
          runs: outline?.runs ?? [],
          waitingOnTheUser,
          stateChanges,
          personName: (roleKey) => (roleKey === latestRoleKey ? latestName : undefined),
          tokens: tokens.reduce((sum, used) => sum + used.tokens, 0),
        });
      },
    );
    return read.flatMap((each) => each ?? []);
  }
}
