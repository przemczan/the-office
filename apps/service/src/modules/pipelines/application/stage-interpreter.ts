import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { DecisionAnswered } from "../../conversations/index.js";
import { TaskStarted } from "../../work/index.js";
import { nextMove, type NextMove } from "../domain/pipeline-walk.js";
import { STAGE_KIND_NAMES, type Stage } from "../domain/stage.js";
import type { StageOutcome, StageRun } from "../domain/stage-run.js";
import { endStageRun, startStageRun } from "../domain/stage-run-changes.js";
import {
  BudgetReached,
  DefinitionOfDoneNotMet,
  NoRetriesLeft,
  PipelineCompleted,
  StageSkipped,
  WentBackToStage,
} from "../domain/stage-run-events.js";
import { walkAnswerOf, walkDecision, type DecisionAnswer } from "../domain/walk-decisions.js";
import { StageDecisions } from "../ports/stage-decisions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskRecords } from "../ports/task-records.js";
import type { StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";
import { TaskStagesService } from "./task-stages-service.js";

type RunMove = Extract<NextMove, { move: "run" }>;
type SkipMove = Extract<NextMove, { move: "skip" }>;
type AskMove = Extract<NextMove, { move: "ask" }>;

/**
 * The Stage interpreter (spec §5.3): one walk over a started Task's own Stages, as data. Each Stage's
 * work is its kind's runner's; the walk keeps the runs, follows the loops, asks the user where the
 * Pipeline says to, and moves the Task. A walk goes on in the background, one per Task, from where
 * the Task's runs left it, and goes on again once the user answers what it asked.
 */
@Injectable()
export class StageInterpreter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StageInterpreter.name);
  private readonly walks = new Map<string, Promise<void>>();
  /** Tasks asked to walk while their walk was going on, walked again once it ends. */
  private readonly walksAgain = new Set<string>();
  private stopping = false;

  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly runs: StageRunRepository,
    private readonly runners: StageRunners,
    private readonly tasks: StartedTasks,
    private readonly records: TaskRecords,
    private readonly decisions: StageDecisions,
    private readonly events: EventBus,
    private readonly telemetry: Telemetry,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStarted, ({ taskId }) => this.walkInBackground(taskId));
    this.events.subscribe(DecisionAnswered, ({ decision }) => {
      if (!decision.answer) return;
      const { answeredAt: _answeredAt, ...answer } = decision.answer;
      return this.takeAnswer(decision.taskId, decision.id, answer);
    });
  }

  /**
   * Keeps the user's answer to a Decision the walk opened on one of the Task's runs, as data the
   * walk replays, and lets the walk go on from it. An answer to another Decision is none of the
   * walk's, and one taken already is left as it is.
   */
  async takeAnswer(taskId: string, decisionId: string, answer: DecisionAnswer): Promise<void> {
    const runs = await this.runs.list(taskId);
    const run = runs.find(({ decisions }) => decisions.some(({ id }) => id === decisionId));
    const decision = run?.decisions.find(({ id }) => id === decisionId);
    if (!run || !decision || decision.answer) return;
    const taken = { ...decision, answer: walkAnswerOf(decision, answer) };
    await this.runs.saveDecisions(
      run.id,
      run.decisions.map((each) => (each.id === decisionId ? taken : each)),
    );
    if ((await this.tasks.read(taskId)).state !== "waiting-on-you") return;
    await this.tasks.changeState(taskId, "in-progress");
    this.walkInBackground(taskId);
  }

  /** The service stops once every walk has ended the Stage it runs; none starts another. */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.walks.values());
  }

  /**
   * Walks the Task's Stages while it is In progress, returning at once; a failure goes into the log.
   * A walk of the Task already going on is left to go on, and the Task is walked again once it
   * ends, as an answer may have moved it back to In progress after that walk last looked.
   */
  walkInBackground(taskId: string): void {
    if (this.walks.has(taskId)) {
      this.walksAgain.add(taskId);
      return;
    }
    const walk = this.walk(taskId)
      .catch((error: unknown) => {
        this.logger.error(`The walk of Task ${taskId}'s Stages failed`, stackOf(error));
      })
      .finally(() => {
        this.walks.delete(taskId);
        if (this.walksAgain.delete(taskId) && !this.stopping) this.walkInBackground(taskId);
      });
    this.walks.set(taskId, walk);
  }

  /** Resolves once the Task's walks, if any go on, have stopped. */
  async walked(taskId: string): Promise<void> {
    for (let walk = this.walks.get(taskId); walk; walk = this.walks.get(taskId)) await walk;
  }

  /**
   * One trace per Task: the first walk begins it, and every later walk, after an answer or a
   * restart, joins it, so its Stages and their engine calls are traced together.
   */
  private async walk(taskId: string): Promise<void> {
    // The Task's own Stages, made here too: the event bus only logs a copy that failed as it started.
    const { stages, pipelineId, trace } = await this.taskStages.make(
      taskId,
      (await this.tasks.read(taskId)).pipelineId,
    );
    const attributes = { "office.task.id": taskId, "office.pipeline": pipelineId };
    await this.telemetry.inTrace("walk", attributes, trace, async (_span, root) => {
      if (!trace) await this.taskStages.saveTrace(taskId, root);
      await this.walkStages(taskId, stages);
    });
  }

  private async walkStages(taskId: string, stages: readonly Stage[]): Promise<void> {
    // Locked once the Task is Ready, so one read serves the whole walk.
    const { definitionOfDone } = await this.records.read(taskId);
    while (!this.stopping) {
      // Dropped, Paused or Waiting on you meanwhile: the walk stops where the runs stand.
      if ((await this.tasks.read(taskId)).state !== "in-progress") return;
      const runs = await this.runs.list(taskId);
      const move = nextMove(stages, runs, definitionOfDone);
      if (move.move === "skip") {
        if (!(await this.skip(taskId, move, runs))) return;
        continue;
      }
      if (move.move !== "run") {
        await this.halt(taskId, move, runs);
        if (!(await this.answeredMeanwhile(taskId, stages, definitionOfDone))) return;
        await this.tasks.changeState(taskId, "in-progress");
        continue;
      }
      if (!(await this.runStage(taskId, move, stages, runs))) return;
    }
  }

  /**
   * Records the optional Stage as skipped, a run done without running anything, so the walk goes
   * on past it as it replays. False when another walk of the Task recorded a run first.
   */
  private async skip(
    taskId: string,
    { stage }: SkipMove,
    earlierRuns: readonly StageRun[],
  ): Promise<boolean> {
    const now = new Date();
    const started = startStageRun(
      { id: randomUUID(), taskId, stageKey: stage.key, carriedFailure: undefined },
      earlierRuns.length,
      now,
    );
    return this.inStageSpan(started.run, stage, async () => {
      if (!(await this.runs.saveNew(started.run))) return false;
      const summary =
        "Skipped: every statement of the Definition of Done was already reported met, and the Stage is optional.";
      const ended = endStageRun(started.run, { status: "done", summary, skipped: true }, now);
      await this.runs.saveEnded(ended.run);
      await this.events.publish(new StageSkipped(taskId, ended.run.id, stage.key));
      return true;
    });
  }

  /** A span per Stage run, whose engine calls are its children. */
  private inStageSpan(run: StageRun, stage: Stage, work: () => Promise<boolean>): Promise<boolean> {
    const attributes = {
      "office.stage": stage.name,
      "office.stage.kind": stage.kind,
      "office.stage.run": run.number,
    };
    return this.telemetry.inSpan("stage", attributes, work);
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
    return this.inStageSpan(started.run, stage, async () => {
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
    });
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

  private async halt(
    taskId: string,
    move: Exclude<NextMove, RunMove | SkipMove>,
    runs: readonly StageRun[],
  ): Promise<void> {
    switch (move.move) {
      case "wait":
        if (!move.run.outcome) {
          this.logger.warn(`Stage run ${move.run.id} of Task ${taskId} was left running.`);
          return;
        }
        await this.tasks.changeState(taskId, "waiting-on-you");
        return;
      case "ask":
        // The Decision first, so a Task Waiting on you always has the Decision it waits on.
        await this.ask(taskId, move, runs);
        await this.tasks.changeState(taskId, "waiting-on-you");
        return;
      case "complete":
        await this.tasks.changeState(taskId, "done");
        await this.events.publish(new PipelineCompleted(taskId));
        return;
      case "drop":
        await this.tasks.changeState(taskId, "dropped");
    }
  }

  /**
   * Whether the user answered while the walk was moving the Task to Waiting on you: the answer then
   * found it In progress and left this walk to go on, which it does once the Task is In progress again.
   */
  private async answeredMeanwhile(
    taskId: string,
    stages: readonly Stage[],
    definitionOfDone: readonly string[],
  ): Promise<boolean> {
    if ((await this.tasks.read(taskId)).state !== "waiting-on-you") return false;
    const runs = await this.runs.list(taskId);
    return nextMove(stages, runs, definitionOfDone).move !== "wait";
  }

  /**
   * Opens the Decision on the run: the Agent's own in its Stage Thread, The Office's in the Thread
   * of the Task's last Agent Stage run (spec §2.3: in tier 1 The Office asks the user directly).
   */
  private async ask(
    taskId: string,
    { run, question }: AskMove,
    runs: readonly StageRun[],
  ): Promise<void> {
    const decision = walkDecision(run, question);
    const threadId = decision.byTheOffice
      ? runs.findLast((each) => each.threadId !== undefined)?.threadId
      : run.threadId;
    const id = await this.decisions.open({
      taskId,
      threadId,
      byTheOffice: decision.byTheOffice,
      draft: decision.draft,
    });
    await this.runs.saveDecisions(run.id, [
      ...run.decisions,
      { id, kind: decision.kind, options: decision.options, answer: undefined },
    ]);
    if (question.kind === "no-retries-left") {
      await this.events.publish(new NoRetriesLeft(taskId, run.stageKey, question.error));
    }
    if (question.kind === "budget") {
      const { used, budget } = question.reached;
      await this.events.publish(new BudgetReached(taskId, run.stageKey, used, budget));
    }
    if (question.kind === "definition-of-done") {
      await this.events.publish(new DefinitionOfDoneNotMet(taskId, question.unmet));
    }
  }
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
