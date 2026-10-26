import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskStarted } from "../../work/index.js";
import { nextMove, type NextMove } from "../domain/pipeline-walk.js";
import { STAGE_KIND_NAMES, type Stage } from "../domain/stage.js";
import type { StageOutcome, StageRun } from "../domain/stage-run.js";
import { endStageRun, startStageRun } from "../domain/stage-run-changes.js";
import { NoRetriesLeft, PipelineCompleted, WentBackToStage } from "../domain/stage-run-events.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks } from "../ports/started-tasks.js";
import type { StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";
import { TaskStagesService } from "./task-stages-service.js";

type RunMove = Extract<NextMove, { move: "run" }>;

/**
 * The Stage interpreter (spec §5.3): one walk over a started Task's own Stages, as data. Each Stage's
 * work is its kind's runner's; the walk keeps the runs, follows the loops and moves the Task. A walk
 * goes on in the background, one per Task, from where the Task's runs left it.
 */
@Injectable()
export class StageInterpreter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StageInterpreter.name);
  private readonly walks = new Map<string, Promise<void>>();
  private stopping = false;

  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly runs: StageRunRepository,
    private readonly runners: StageRunners,
    private readonly tasks: StartedTasks,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStarted, ({ taskId }) => this.walkInBackground(taskId));
  }

  /** The service stops once every walk has ended the Stage it runs; none starts another. */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.walks.values());
  }

  /**
   * Walks the Task's Stages while it is In progress, returning at once. A walk of the Task already
   * going on is left to go on; a failure goes into the log.
   */
  walkInBackground(taskId: string): void {
    if (this.walks.has(taskId)) return;
    const walk = this.walk(taskId)
      .catch((error: unknown) => {
        this.logger.error(`The walk of Task ${taskId}'s Stages failed`, stackOf(error));
      })
      .finally(() => this.walks.delete(taskId));
    this.walks.set(taskId, walk);
  }

  /** Resolves once the Task's walk, if one goes on, has stopped. */
  async walked(taskId: string): Promise<void> {
    await this.walks.get(taskId);
  }

  private async walk(taskId: string): Promise<void> {
    // The Task's own Stages, made here too: the event bus only logs a copy that failed as it started.
    const { stages } = await this.taskStages.make(
      taskId,
      (await this.tasks.read(taskId)).pipelineId,
    );
    while (!this.stopping) {
      // Dropped, Paused or Waiting on you meanwhile: the walk stops where the runs stand.
      if ((await this.tasks.read(taskId)).state !== "in-progress") return;
      const runs = await this.runs.list(taskId);
      const move = nextMove(stages, runs);
      if (move.move !== "run") return this.halt(taskId, move);
      if (!(await this.runStage(taskId, move, stages, runs))) return;
    }
  }

  /** False when another walk of the Task started the run first. */
  private async runStage(
    taskId: string,
    move: RunMove,
    stages: readonly Stage[],
    earlierRuns: readonly StageRun[],
  ): Promise<boolean> {
    const { stage, carriedFailure } = move;
    const started = startStageRun(
      { id: randomUUID(), taskId, stageKey: stage.key, carriedFailure },
      earlierRuns.length,
      new Date(),
    );
    if (!(await this.runs.saveNew(started.run))) return false;
    if (carriedFailure) {
      const { stageKey, round, rounds } = carriedFailure;
      await this.events.publish(new WentBackToStage(taskId, stageKey, stage.key, round, rounds));
    }
    await this.events.publish(started.event);
    const work = { stage, run: started.run, stages, earlierRuns };
    const ended = endStageRun(started.run, await this.outcomeOf(work), new Date());
    await this.runs.saveEnded(ended.run);
    await this.events.publish(ended.event);
    return true;
  }

  /** A runner that throws ends its run failed with the reason, so no run is left running. */
  private async outcomeOf(work: StageWork): Promise<StageOutcome> {
    const { stage, run } = work;
    const runner = this.runners.runnerOf(stage.kind);
    if (!runner) {
      return {
        status: "failed",
        error: `The Office can't run this ${STAGE_KIND_NAMES[stage.kind]} yet.`,
      };
    }
    try {
      return await runner.run(work);
    } catch (error) {
      this.logger.error(`Stage run ${run.id} of Task ${run.taskId} failed`, stackOf(error));
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async halt(taskId: string, move: Exclude<NextMove, RunMove>): Promise<void> {
    switch (move.move) {
      case "wait":
        if (!move.run.outcome) {
          this.logger.warn(`Stage run ${move.run.id} of Task ${taskId} was left running.`);
          return;
        }
        await this.tasks.changeState(taskId, "waiting-on-you");
        return;
      case "stop":
        await this.tasks.changeState(taskId, "waiting-on-you");
        // Who is asked about it (spec §2.3) hears of it here.
        await this.events.publish(new NoRetriesLeft(taskId, move.run.stageKey, move.error));
        return;
      case "complete":
        await this.tasks.changeState(taskId, "done");
        await this.events.publish(new PipelineCompleted(taskId));
    }
  }
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
