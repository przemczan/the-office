import { walkedStages } from "../domain/resolve-stages.js";
import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { DecisionAnswered } from "../../conversations/index.js";
import { CTO } from "../../people/index.js";
import {
  AlarmSounded,
  TaskPaused,
  TaskResumed,
  TaskStarted,
  TaskStopped,
} from "../../work/index.js";
import { StaffingHolds } from "./staffing-holds.js";
import { nextMove, type NextMove } from "../domain/pipeline-walk.js";
import { STAGE_KIND_NAMES, type Stage } from "../domain/stage.js";
import {
  closingOf,
  interruptedOutcome,
  notStartedOutcome,
  outranks,
} from "../domain/stage-interruption.js";
import type {
  StageInterruption,
  StageOutcome,
  StageRun,
  AskedInterruption,
} from "../domain/stage-run.js";
import { endStageRun, startStageRun } from "../domain/stage-run-changes.js";
import {
  BudgetReached,
  DefinitionOfDoneNotMet,
  NoRetriesLeft,
  PipelineCompleted,
  StageSkipped,
  StopHeldAsPause,
  WentBackToStage,
} from "../domain/stage-run-events.js";
import {
  agentDecision,
  asksTheCtoFirst,
  walkAnswerOf,
  walkDecision,
  type DecisionAnswer,
} from "../domain/walk-decisions.js";
import { StageDecisions } from "../ports/stage-decisions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads } from "../ports/stage-threads.js";
import { StartedTasks, type StartedTask } from "../ports/started-tasks.js";
import { TaskRecords } from "../ports/task-records.js";
import { StageGit } from "./stage-git.js";
import { StageRunInterruption } from "./stage-run-interruption.js";
import type { StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";
import { TaskStagesService } from "./task-stages-service.js";

type RunMove = Extract<NextMove, { move: "run" }>;
type SkipMove = Extract<NextMove, { move: "skip" }>;
type HaltMove = Exclude<NextMove, RunMove | SkipMove>;

/** A run the walk started, with the Stages and runs it was started from. */
interface StartedStep {
  readonly step: "started";
  readonly stage: Stage;
  readonly started: ReturnType<typeof startStageRun>;
  readonly stages: readonly Stage[];
  readonly earlierRuns: readonly StageRun[];
}

/** What the walk did at its next move, or why it waits there. */
type WalkStep =
  | { readonly step: "over" }
  | { readonly step: "skipped" }
  | StartedStep
  | {
      readonly step: "halt";
      readonly move: HaltMove;
      readonly stages: readonly Stage[];
      readonly runs: readonly StageRun[];
    };
type AskMove = Extract<NextMove, { move: "ask" }>;

/**
 * The Stage interpreter (spec §5.3): one walk over a started Task's own Stages, as data. Each Stage's
 * work is its kind's runner's; the walk keeps the runs, follows the loops, asks the user where the
 * Pipeline says to, and moves the Task. A walk goes on in the background, one per Task, from where
 * the Task's runs left it, and goes on again once the user answers what it asked or resumes the
 * Task. A Task the user pauses is held once its Agent's running turn ends, mid-Stage; one they
 * stop has that turn stopped now (spec §2.4). Either way the Stage runs again once resumed. The
 * fire alarm holds every running Stage as a Pause does, its commands stopped now, and cuts the
 * turns still running short at its hard stop (spec §2.8). The Office shutting down stops every
 * running turn and command now; a Stage it restarted during runs again only once the user says so.
 */
@Injectable()
export class StageInterpreter implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StageInterpreter.name);
  private readonly walks = new Map<string, Promise<void>>();
  /** Tasks asked to walk while their walk was going on, walked again once it ends. */
  private readonly walksAgain = new Set<string>();
  /**
   * The user's Stop or Pause of each walk's Stage run, or the fire alarm, from before the walk reads
   * the state for it.
   */
  private readonly interruptions = new Map<string, StageRunInterruption>();
  /** The fire alarm's hard stop of the runs going on as it sounded, until it comes. */
  private hardStop: Wait | undefined;
  private stopping = false;

  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly runs: StageRunRepository,
    private readonly runners: StageRunners,
    private readonly tasks: StartedTasks,
    private readonly records: TaskRecords,
    private readonly decisions: StageDecisions,
    private readonly stageGit: StageGit,
    private readonly threads: StageThreads,
    private readonly events: EventBus,
    private readonly telemetry: Telemetry,
    private readonly staffingHolds: StaffingHolds,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStarted, ({ taskId }) => this.walkInBackground(taskId));
    this.events.subscribe(TaskResumed, async ({ taskId }) => {
      if (!(await this.staffingHolds.holdIfLackingPeople(taskId))) this.walkInBackground(taskId);
    });
    this.events.subscribe(TaskPaused, ({ taskId, by }) =>
      this.interrupt(taskId, by === "alarm" ? "alarm" : "pause"),
    );
    this.events.subscribe(AlarmSounded, ({ hardStopAt }) => this.hardStopAt(hardStopAt));
    this.events.subscribe(TaskStopped, ({ taskId }) => this.interrupt(taskId, "stop"));
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
    if (!run || !(await this.keepAnswers(run, new Map([[decisionId, answer]])))) return;
    await this.goOn(taskId);
  }

  /**
   * Lets the walk go on from what the user did on a Task Waiting on you. A Task they paused stays
   * Paused until they resume it; a walk moving the Task to Waiting on you meanwhile sees the change
   * and goes on itself.
   */
  async goOn(taskId: string): Promise<void> {
    if ((await this.tasks.read(taskId)).state !== "waiting-on-you") return;
    await this.tasks.changeState(taskId, "in-progress");
    this.walkInBackground(taskId);
  }

  /**
   * Keeps the given answers on the run's Decisions that are still open; false when none was.
   * One taken already is left as it is.
   */
  private async keepAnswers(
    run: StageRun,
    answers: ReadonlyMap<string, DecisionAnswer>,
  ): Promise<boolean> {
    let kept = false;
    const decisions = run.decisions.map((decision) => {
      const answer = answers.get(decision.id);
      if (decision.answer || !answer) return decision;
      kept = true;
      return { ...decision, answer: walkAnswerOf(decision, answer) };
    });
    if (kept) await this.runs.saveDecisions(run.id, decisions);
    return kept;
  }

  /**
   * Keeps the answers the user gave in Conversations to the run's open Decisions: an answer given
   * before the run kept its Decision, such as one the Agent opened while its Stage still ran,
   * found no run as it came. False when none is answered there.
   */
  private async takeRecordedAnswers(run: StageRun): Promise<boolean> {
    const answers = new Map<string, DecisionAnswer>();
    for (const { id, answer } of run.decisions) {
      const recorded = answer ? undefined : await this.decisions.answerOf(id);
      if (recorded) answers.set(id, recorded);
    }
    return answers.size > 0 && this.keepAnswers(run, answers);
  }

  /**
   * Cuts short, at `at`, the Agent turns of the runs going on now, which the fire alarm holds
   * (spec §2.8): those it holds later never started a turn, and a run started after the all clear
   * is none of these.
   */
  private hardStopAt(at: Date): void {
    const going = [...this.interruptions.values()];
    this.hardStop?.cancel();
    this.hardStop = this.schedule.once("the fire alarm's hard stop", at, async () => {
      this.hardStop = undefined;
      for (const interruption of going) interruption.hardStop();
    });
  }

  /**
   * Holds the Stage run of the Task's walk, if one goes on: its runner stops the Agent's turn now
   * (Stop) or once it ends (Pause, the fire alarm), and ends the run as interrupted. A walk about to start one
   * records it held without running it. The run records what the user asked, so a start after a
   * crash honours it.
   */
  async interrupt(taskId: string, interruption: AskedInterruption): Promise<void> {
    this.interruptions.get(taskId)?.request(interruption);
    const running = (await this.runs.list(taskId)).at(-1);
    if (!running || running.outcome || !outranks(interruption, running.heldBy)) return;
    await this.runs.saveHeldBy(running.id, interruption);
  }

  /**
   * Takes up what the service left as it last stopped (spec §2.4): a run left running ends as The
   * Office restarted during it, or as held with its edits on a Task the user paused or the fire
   * alarm holds, its Stage Thread with it. An In progress Task is walked on, unless the alarm is on
   * (a sounding the service stopped during), which holds it instead; but a Stage it would start,
   * after one The Office restarted between, is first recorded as not started, so the walk asks the
   * user before any Stage runs again or starts. A Paused Task stays as the user, or the alarm,
   * holds it.
   */
  async onApplicationBootstrap(): Promise<void> {
    for (const task of await this.tasks.list()) {
      if (task.state !== "in-progress" && task.state !== "paused") continue;
      await this.takeUpAfterRestart(task).catch((error: unknown) => {
        this.logger.error(`Task ${task.id}'s Stage runs weren't taken up`, stackOf(error));
      });
    }
  }

  /**
   * The service stops once every walk has ended the Stage it runs, interrupted as a Stop would but
   * with its Project commands stopped too, so none waits for a turn or a command to end; none
   * starts another.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.hardStop?.cancel();
    for (const interruption of this.interruptions.values()) interruption.request("restart");
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
        this.interruptions.delete(taskId);
        if (this.walksAgain.delete(taskId) && !this.stopping) this.walkInBackground(taskId);
      });
    this.walks.set(taskId, walk);
  }

  private async takeUpAfterRestart(task: StartedTask): Promise<void> {
    const { id } = task;
    // A Task whose walk never began has no Stages of its own yet, and nothing to take up.
    const own = await this.taskStages.find(id);
    if (!own) return;
    const held = task.state === "in-progress" && (await this.tasks.holdForFireAlarm(id));
    const { state, pausedByAlarm } = held ? await this.tasks.read(id) : task;
    const runs = await this.runs.list(id);
    const last = runs.at(-1);
    if (last && !last.outcome) {
      await this.endLeftRunning(last, runs.slice(0, -1), { state, pausedByAlarm });
    }
    if (state !== "in-progress") return;
    const { definitionOfDone } = await this.records.read(id);
    const ended = await this.runs.list(id);
    const move = nextMove(own.stages, ended, definitionOfDone);
    if (move.move === "run" || move.move === "skip") {
      await this.recordNotStarted(id, move, ended);
    }
    this.walkInBackground(id);
  }

  /**
   * Ends the run as The Office restarted during it, its uncommitted edits discarded, and its Stage
   * Thread's work with it; or as asked of it before the crash: a Stop ends it stopped, its edits
   * discarded, and a Pause or the fire alarm, waiting for the Agent's turn the crash cut short,
   * holds it with its edits kept. A Paused Task with nothing recorded counts as held by whoever
   * paused it.
   */
  private async endLeftRunning(
    run: StageRun,
    earlierRuns: readonly StageRun[],
    held: Pick<StartedTask, "state" | "pausedByAlarm">,
  ): Promise<void> {
    const interruption: StageInterruption = run.heldBy ?? heldByAfterRestart(held);
    const task = await this.records.read(run.taskId);
    const discarded = await this.stageGit.settleLeftRunning(
      { run, earlierRuns },
      task,
      interruption,
    );
    const outcome = interruptedOutcome(interruption, discarded, { cutShortBy: "restart" });
    const ended = endStageRun(run, outcome, new Date());
    await this.runs.saveEnded(ended.run);
    const closing = closingOf(outcome);
    if (run.threadId && closing) {
      const asked = await this.threads.endLeftRunning(run.threadId, closing, run.startedAt);
      // As a held run keeps it: nothing runs again until the user answers it.
      if (asked && !run.decisions.some(({ id }) => id === asked.id)) {
        await this.runs.saveDecisions(run.id, [...run.decisions, agentDecision(asked)]);
      }
    }
    await this.events.publish(ended.event);
    this.logger.warn(
      `Stage run ${run.id} of Task ${run.taskId} was left running as The Office stopped.`,
    );
  }

  /** Records the Stage the walk would start next as not started, which the walk then asks about. */
  private async recordNotStarted(
    taskId: string,
    { stage, ...move }: RunMove | SkipMove,
    earlierRuns: readonly StageRun[],
  ): Promise<void> {
    const { carriedFailure, sentBack } =
      move.move === "run" ? move : { carriedFailure: undefined, sentBack: undefined };
    const now = new Date();
    const started = startStageRun(
      { id: randomUUID(), taskId, stageKey: stage.key, carriedFailure, sentBack },
      earlierRuns.length,
      now,
    );
    if (!(await this.runs.saveNew(started.run))) return;
    const ended = endStageRun(started.run, notStartedOutcome(), now);
    await this.runs.saveEnded(ended.run);
    await this.events.publish(ended.event);
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
    const { pipelineId, trace } = await this.taskStages.make(
      taskId,
      (await this.tasks.read(taskId)).pipelineId,
    );
    const attributes = { "office.task.id": taskId, "office.pipeline": pipelineId };
    await this.telemetry.inTrace("walk", attributes, trace, async (_span, root) => {
      if (!trace) await this.taskStages.saveTrace(taskId, root);
      await this.walkStages(taskId);
    });
  }

  private async walkStages(taskId: string): Promise<void> {
    // Locked once the Task is Ready, so one read serves the whole walk.
    const { definitionOfDone } = await this.records.read(taskId);
    while (!this.stopping) {
      // Before the state is read, so a Stop after the read interrupts the run it leads to.
      const interruption = new StageRunInterruption();
      this.interruptions.set(taskId, interruption);
      // Dropped, Paused or Waiting on you meanwhile: the walk stops where the runs stand.
      if ((await this.tasks.read(taskId)).state !== "in-progress") return;
      // Read afresh each move, so an edit of the Task's Stages for the Task applies to the next one.
      const step = await this.taskStages.holding(taskId, ({ stages }) =>
        this.takeNextMove(taskId, stages, definitionOfDone),
      );
      if (step.step === "over") return;
      if (step.step === "skipped") continue;
      if (step.step === "started") {
        await this.runStage(step, interruption);
        continue;
      }
      const { move, runs, stages } = step;
      if (move.move === "wait" && move.run.outcome && (await this.takeRecordedAnswers(move.run))) {
        continue;
      }
      await this.halt(taskId, move, runs);
      if (!(await this.answeredMeanwhile(taskId, stages, definitionOfDone))) return;
      await this.tasks.changeState(taskId, "in-progress");
    }
  }

  /**
   * The walk's next move, taken while no edit can change the Task's Stages: an optional Stage
   * skipped, or a run started and saved. Over when another walk of the Task moved first, or The
   * Office is stopping.
   */
  private async takeNextMove(
    taskId: string,
    stages: readonly Stage[],
    definitionOfDone: readonly string[],
  ): Promise<WalkStep> {
    const runs = await this.runs.list(taskId);
    const move = nextMove(stages, runs, definitionOfDone);
    if (move.move === "skip") {
      return (await this.skip(taskId, move, runs)) ? { step: "skipped" } : { step: "over" };
    }
    if (move.move !== "run") return { step: "halt", move, stages, runs };
    if (this.stopping) return { step: "over" };
    const { stage, carriedFailure, sentBack } = move;
    const started = startStageRun(
      { id: randomUUID(), taskId, stageKey: stage.key, carriedFailure, sentBack },
      runs.length,
      new Date(),
    );
    if (!(await this.runs.saveNew(started.run))) return { step: "over" };
    return {
      step: "started",
      stage,
      started,
      stages: walkedStages(stages, runs),
      earlierRuns: runs,
    };
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
      {
        id: randomUUID(),
        taskId,
        stageKey: stage.key,
        carriedFailure: undefined,
        sentBack: undefined,
      },
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

  /** Runs the Stage of the run the walk started, to its end. */
  private async runStage(
    { stage, started, stages, earlierRuns }: StartedStep,
    interruption: StageRunInterruption,
  ): Promise<void> {
    const { taskId, carriedFailure } = started.run;
    await this.inStageSpan(started.run, stage, async () => {
      if (carriedFailure) {
        const { stageKey, round, rounds } = carriedFailure;
        await this.events.publish(new WentBackToStage(taskId, stageKey, stage.key, round, rounds));
      }
      await this.events.publish(started.event);
      const work = { stage, run: started.run, stages, earlierRuns, interruption };
      const ended = endStageRun(started.run, await this.outcomeOf(work), new Date());
      await this.runs.saveEnded(ended.run);
      await this.events.publish(ended.event);
      await this.tellStopHeldAsPause(ended.run, interruption);
      return true;
    });
  }

  /** A runner that throws ends its run failed with the reason, so no run is left running. */
  private async outcomeOf(work: StageWork): Promise<StageOutcome> {
    const { stage, run, interruption } = work;
    // Held before it began, so it did nothing to discard.
    if (interruption.requested) return interruptedOutcome(interruption.requested, []);
    try {
      const runner = this.runners.runnerOf(stage.kind);
      // Each kind's runner registers as the module starts, so a missing one is a fault.
      if (!runner) throw new Error(`No runner runs ${STAGE_KIND_NAMES[stage.kind]}s.`);
      return await runner.run(work);
    } catch (error) {
      this.logger.error(`Stage run ${run.id} of Task ${run.taskId} failed`, stackOf(error));
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * The user stopped the run, but nothing of it could be interrupted any more, such as a Script
   * Stage's command, or an Agent Stage whose result was already read: it ran to its end, and the
   * Task is held after it, as a Pause would.
   */
  private async tellStopHeldAsPause(
    run: StageRun,
    interruption: StageRunInterruption,
  ): Promise<void> {
    if (interruption.requested !== "stop") return;
    if (run.outcome?.status === "failed" && run.outcome.interrupted) return;
    this.logger.log(
      `Stage run ${run.id} of Task ${run.taskId} ran to its end after the user's Stop.`,
    );
    await this.events.publish(new StopHeldAsPause(run.taskId, run.id, run.stageKey));
  }

  private async halt(taskId: string, move: HaltMove, runs: readonly StageRun[]): Promise<void> {
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
        // A Task paused meanwhile stays Paused, and completes once resumed.
        if ((await this.tasks.changeState(taskId, "done")).state !== "done") return;
        await this.events.publish(new PipelineCompleted(taskId));
        return;
      case "drop":
        await this.tasks.changeState(taskId, "dropped");
    }
  }

  /**
   * Whether the user answered while the walk was moving the Task to Waiting on you: the answer then
   * found it In progress, or found no run keeping the Decision yet, and left this walk to go on,
   * which it does once the Task is In progress again.
   */
  private async answeredMeanwhile(
    taskId: string,
    stages: readonly Stage[],
    definitionOfDone: readonly string[],
  ): Promise<boolean> {
    if ((await this.tasks.read(taskId)).state !== "waiting-on-you") return false;
    const move = nextMove(stages, await this.runs.list(taskId), definitionOfDone);
    return move.move !== "wait" || this.takeRecordedAnswers(move.run);
  }

  /**
   * Opens The Office's Decision on the run, in the Thread of the Task's last Agent Stage run: put
   * to the CTO first when the question is theirs (spec §2.3), otherwise to the user.
   */
  private async ask(
    taskId: string,
    { run, question }: AskMove,
    runs: readonly StageRun[],
  ): Promise<void> {
    const decision = walkDecision(run, question);
    const threadId = runs.findLast((each) => each.threadId !== undefined)?.threadId;
    const { id, putTo } = await this.decisions.open({
      taskId,
      threadId,
      draft: decision.draft,
      ...(asksTheCtoFirst(question, runs) && { putTo: CTO }),
    });
    await this.runs.saveDecisions(run.id, [
      ...run.decisions,
      { id, kind: decision.kind, options: decision.options, answer: undefined },
    ]);
    if (question.kind === "no-retries-left") {
      await this.events.publish(new NoRetriesLeft(taskId, run.stageKey, question.error, putTo));
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

/** What holds a run left running with nothing recorded on it, by the state of its Task. */
function heldByAfterRestart({
  state,
  pausedByAlarm,
}: Pick<StartedTask, "state" | "pausedByAlarm">): StageInterruption {
  if (state !== "paused") return "restart";
  return pausedByAlarm ? "alarm" : "pause";
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
