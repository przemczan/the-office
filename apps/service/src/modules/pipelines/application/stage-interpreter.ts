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
import { DecisionAnswered, stageAnswerOf } from "../../conversations/index.js";
import { ScheduledExitCancelled, ScheduledExitHold } from "../../office-updates/index.js";
import {
  AlarmSounded,
  STARTED_STATES,
  TaskDependencyRemoved,
  TaskPaused,
  TaskResumed,
  TaskStarted,
  TaskStateChanged,
  TaskStopped,
} from "../../work/index.js";
import { ConditionCommands, type WeighCommandMove } from "./condition-commands.js";
import { StaffingHolds } from "./staffing-holds.js";
import { nextMove, type NextMove } from "../domain/pipeline-walk.js";
import { STAGE_KIND_NAMES, type Stage } from "../domain/stage.js";
import { closingOf, interruptedOutcome, outranks } from "../domain/stage-interruption.js";
import type {
  StageInterruption,
  StageOutcome,
  StageRun,
  AskedInterruption,
  HoldingUser,
} from "../domain/stage-run.js";
import { endStageRun, startStageRun } from "../domain/stage-run-changes.js";
import { staffedRole } from "../domain/stage-staffing.js";
import {
  BudgetReached,
  DefinitionOfDoneNotMet,
  NoRetriesLeft,
  PipelineCompleted,
  StopHeldAsPause,
  WentBackToStage,
} from "../domain/stage-run-events.js";
import {
  agentDecision,
  asksAConsultantFirst,
  walkAnswerOf,
  walkDecision,
  type DecisionAnswer,
} from "../domain/walk-decisions.js";
import { KnownPeople } from "../ports/known-people.js";
import { StageDecisions } from "../ports/stage-decisions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads } from "../ports/stage-threads.js";
import { StartedTasks, type StartedTask } from "../ports/started-tasks.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
import { InitiativeBranchStages } from "./initiative-branch-stages.js";
import { RoleFillings } from "./role-fillings.js";
import { StageGit } from "./stage-git.js";
import { StageRunInterruption } from "./stage-run-interruption.js";
import type { StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";
import { StageRunsRunningNow } from "./stage-runs-running-now.js";
import { TaskStagesService } from "./task-stages-service.js";

type RunMove = Extract<NextMove, { move: "run" }>;
type HaltMove = Exclude<NextMove, RunMove | WeighCommandMove>;

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
  /** A condition's command was weighed, its result recorded for the walk to go on from. */
  | { readonly step: "weighed" }
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
 * running turn and command now, keeping the Stage's edits, and the Stage goes on by itself as it
 * starts again (spec §2.4).
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
  /**
   * Tasks whose walk a scheduled Office update or restart held at their next Stage, walked on once
   * cancelled.
   */
  private readonly heldForExit = new Set<string>();
  /**
   * Started Publishing Tasks whose walk waits before their next Stage for a blocker to be Done or
   * Dropped (spec 2.1, "Publishing Tasks"), walked again as any Task ends or loses a blocker.
   */
  private readonly heldForBlocker = new Set<string>();

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
    private readonly exitHold: ScheduledExitHold,
    private readonly branchStages: InitiativeBranchStages,
    private readonly roleFillings: RoleFillings,
    private readonly people: KnownPeople,
    private readonly conditionCommands: ConditionCommands,
    private readonly runningNow: StageRunsRunningNow,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStarted, ({ taskId }) => this.walkInBackground(taskId));
    this.events.subscribe(TaskResumed, ({ taskId }) => this.walkInBackground(taskId));
    this.events.subscribe(TaskPaused, async ({ taskId, by, user }) => {
      // The Stage runner pauses a Task for a used-up usage window once it held the run itself.
      if (by === "usage-window") return;
      if (by === "alarm") await this.interrupt(taskId, "alarm");
      else await this.interrupt(taskId, "pause", user && holdingUserOf(user));
    });
    this.events.subscribe(AlarmSounded, ({ hardStopAt }) => this.hardStopAt(hardStopAt));
    this.events.subscribe(TaskStopped, ({ taskId, user }) =>
      this.interrupt(taskId, "stop", user && holdingUserOf(user)),
    );
    this.events.subscribe(ScheduledExitCancelled, () => this.walkHeldForExit());
    this.events.subscribe(TaskStateChanged, async ({ taskId, from, to }) => {
      // A started Task dropped, alone or with its Initiative, has its running Stage stopped.
      if (to === "dropped" && STARTED_STATES.includes(from)) await this.interrupt(taskId, "stop");
      if (to === "done" || to === "dropped") this.walkHeldForBlocker();
    });
    this.events.subscribe(TaskDependencyRemoved, () => this.walkHeldForBlocker());
    this.events.subscribe(DecisionAnswered, ({ decision }) => {
      // A call made from a chat is on no Task, so no Pipeline waits on it.
      const answer = stageAnswerOf(decision);
      if (!answer || decision.taskId === undefined) return;
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
   * records it held without running it. The run records what the user asked, and `heldByUser`, who
   * asked, so a start after a crash honours it.
   */
  async interrupt(
    taskId: string,
    interruption: AskedInterruption,
    heldByUser?: HoldingUser,
  ): Promise<void> {
    this.interruptions.get(taskId)?.request(interruption, heldByUser);
    const running = (await this.runs.list(taskId)).at(-1);
    if (!running || running.outcome || !outranks(interruption, running.heldBy)) return;
    await this.runs.saveHeldBy(running.id, interruption, heldByUser);
  }

  /**
   * Takes up what the service left as it last stopped (spec §2.4): a run left running ends as The
   * Office restarted during it, its edits kept, or as held on a Task the user paused or stopped, or
   * the fire alarm or a usage window holds, its Stage Thread with it. An In progress Task is walked
   * on, so the Stage it ran, or the one due next, goes on by itself, unless the alarm is on (a
   * sounding the service stopped during), which holds it instead. A Paused Task stays as the user,
   * the alarm or the usage window holds it.
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
    const { state, pausedBy } = held ? await this.tasks.read(id) : task;
    const runs = await this.runs.list(id);
    const last = runs.at(-1);
    if (last && !last.outcome) {
      await this.endLeftRunning(last, runs.slice(0, -1), { state, pausedBy });
    }
    if (state === "in-progress") this.walkInBackground(id);
  }

  /**
   * Ends the run as The Office restarted during it, its uncommitted edits kept, and its Stage
   * Thread's work with it; or as asked of it before the crash: a Stop ends it stopped, its edits
   * discarded, and a Pause or the fire alarm, waiting for the Agent's turn the crash cut short,
   * holds it with its edits kept. A Paused Task with nothing recorded counts as held by whoever
   * paused it.
   */
  private async endLeftRunning(
    run: StageRun,
    earlierRuns: readonly StageRun[],
    held: Pick<StartedTask, "state" | "pausedBy">,
  ): Promise<void> {
    const interruption: StageInterruption = run.heldBy ?? heldByAfterRestart(held);
    const { heldByUser } = run;
    const task = await this.records.read(run.taskId);
    const discarded = await this.stageGit.settleLeftRunning(
      { run, earlierRuns },
      task,
      interruption,
    );
    const outcome = interruptedOutcome(interruption, discarded, {
      cutShortBy: "restart",
      heldByUser,
    });
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

  private walkHeldForExit(): void {
    for (const taskId of this.heldForExit) this.walkInBackground(taskId);
    this.heldForExit.clear();
  }

  /** Each walk held for a blocker reads its blockers again, and is held again if one is left. */
  private walkHeldForBlocker(): void {
    for (const taskId of this.heldForBlocker) this.walkInBackground(taskId);
    this.heldForBlocker.clear();
  }

  /** Resolves once the Task's walks, if any go on, have stopped. */
  async walked(taskId: string): Promise<void> {
    for (let walk = this.walks.get(taskId); walk; walk = this.walks.get(taskId)) await walk;
  }

  /**
   * One trace per Task: the first walk begins it, and every later walk, after an answer or a
   * restart, joins it, so its Stages and their engine calls are traced together. Each walk first
   * holds the Task when nobody can work the Stages it goes on with: as it starts, with a later Agent
   * Stage's Role vacant, as much as when it resumes.
   */
  private async walk(taskId: string): Promise<void> {
    const task = await this.tasks.read(taskId);
    // Work never starts a Task with no Pipeline, as it is never Ready without one.
    if (task.pipelineId === undefined) throw new Error(`Task ${taskId} has no Pipeline to walk.`);
    // The Task's own Stages, made here too: the event bus only logs a copy that failed as it started.
    const { pipelineId, trace } = await this.taskStages.make(taskId, task.pipelineId);
    if (await this.staffingHolds.holdIfLackingPeople(taskId)) return;
    const attributes = { "office.task": taskId, "office.pipeline": pipelineId };
    await this.telemetry.inTrace("walk", attributes, trace, async (_span, root) => {
      if (!trace) await this.taskStages.saveTrace(taskId, root);
      await this.walkStages(taskId);
    });
  }

  private async walkStages(taskId: string): Promise<void> {
    // Locked once the Task is Ready, so one read serves the whole walk.
    const record = await this.records.read(taskId);
    const { definitionOfDone } = record;
    while (!this.stopping) {
      // Before the state is read, so a Stop after the read interrupts the run it leads to.
      const interruption = new StageRunInterruption();
      this.interruptions.set(taskId, interruption);
      // Dropped, Paused or Waiting on you meanwhile: the walk stops where the runs stand.
      if ((await this.tasks.read(taskId)).state !== "in-progress") return;
      // Read afresh each move, so an edit of the Task's Stages for the Task applies to the next one.
      const step = await this.taskStages.holding(taskId, ({ stages }) =>
        this.takeNextMove(taskId, stages, record, interruption),
      );
      if (step.step === "over") return;
      if (step.step === "weighed") continue;
      if (step.step === "started") {
        await this.runStageOf(record, step, interruption);
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
   * The walk's next move, taken while no edit can change the Task's Stages: a run started and
   * saved, or a condition's command weighed, so the routes it decides between stay as they are.
   * Over when another walk of the Task moved first, or The Office is stopping.
   */
  private async takeNextMove(
    taskId: string,
    stages: readonly Stage[],
    record: TaskRecord,
    interruption: StageRunInterruption,
  ): Promise<WalkStep> {
    const runs = await this.runs.list(taskId);
    // Read once per move, so a Stage starts with whoever holds its duty now (spec §2.3).
    const staffed = await this.roleFillings.staffed(stages, runs);
    const move = nextMove(staffed, runs, record.definitionOfDone);
    if (move.move !== "run" && move.move !== "weigh-command") {
      return { step: "halt", move, stages: staffed, runs };
    }
    if (this.stopping) return { step: "over" };
    // At the Stage boundary, until the update or restart is cancelled or the service exits for it; a
    // Gate does no work, so it still asks the user.
    if (
      this.exitHold.isScheduled() &&
      (move.move === "weigh-command" || move.stage.kind !== "gate")
    ) {
      this.heldForExit.add(taskId);
      return { step: "over" };
    }
    if (move.move === "weigh-command") {
      await this.weighCommand(move, record, walkedStages(staffed, runs), runs, interruption);
      return { step: "weighed" };
    }
    // A Task added to its Initiative meanwhile blocks it; a Gate waits too, as it shows the change.
    // Held before the read, so a blocker ending during it walks the Task again (walksAgain).
    if (record.publishingTask) {
      this.heldForBlocker.add(taskId);
      if ((await this.tasks.waitingFor(taskId)).length > 0) return { step: "over" };
      this.heldForBlocker.delete(taskId);
    }
    const { stage, carriedFailure, sentBack } = move;
    const roleKey = stage.kind === "agent" ? staffedRole(stage) : undefined;
    const started = startStageRun(
      { id: randomUUID(), taskId, stageKey: stage.key, carriedFailure, sentBack, roleKey },
      runs.length,
      new Date(),
    );
    if (!(await this.runs.saveNew(started.run))) return { step: "over" };
    return {
      step: "started",
      stage,
      started,
      stages: walkedStages(staffed, runs),
      earlierRuns: runs,
    };
  }

  /**
   * Runs a condition's command, holding a Publishing Task's Initiative's branch as its Stages do,
   * stopped with the commands of a run the fire alarm or a shutdown interrupts.
   */
  private async weighCommand(
    move: WeighCommandMove,
    record: TaskRecord,
    stages: readonly Stage[],
    runs: readonly StageRun[],
    interruption: StageRunInterruption,
  ): Promise<void> {
    const weigh = () =>
      this.conditionCommands.weigh(move, record, stages, runs, interruption.commandsSignal);
    if (!record.publishingTask) return weigh();
    await this.branchStages.holding(record, weigh);
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

  /**
   * A Publishing Task's Stage runs holding its Initiative's branch, so a fix Task's Publish into it
   * waits for the Stage to end (spec 2.3, "A Publishing Task's Publish").
   */
  private async runStageOf(
    record: TaskRecord,
    step: StartedStep,
    interruption: StageRunInterruption,
  ): Promise<void> {
    if (!record.publishingTask) return this.runStage(step, interruption);
    await this.branchStages.holding(record, () => this.runStage(step, interruption));
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
    if (interruption.requested) {
      return interruptedOutcome(interruption.requested, [], {
        heldByUser: interruption.heldByUser,
      });
    }
    const ended = this.runningNow.began(stage.kind);
    try {
      const runner = this.runners.runnerOf(stage.kind);
      // Each kind's runner registers as the module starts, so a missing one is a fault.
      if (!runner) throw new Error(`No runner runs ${STAGE_KIND_NAMES[stage.kind]}s.`);
      return await runner.run(work);
    } catch (error) {
      this.logger.error(`Stage run ${run.id} of Task ${run.taskId} failed`, stackOf(error));
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      ended();
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
   * first to whoever holds Asked first when a Stage runs out of tries when the question is a
   * Consultant's (spec §2.3), otherwise, or while nobody holds it, to the user.
   */
  private async ask(
    taskId: string,
    { run, question }: AskMove,
    runs: readonly StageRun[],
  ): Promise<void> {
    const decision = walkDecision(run, question);
    const threadId = runs.findLast((each) => each.threadId !== undefined)?.threadId;
    const consultant = asksAConsultantFirst(question, runs)
      ? await this.people.holderOf("asked-first-when-out-of-tries")
      : undefined;
    const { id, putTo } = await this.decisions.open({
      taskId,
      threadId,
      draft: decision.draft,
      ...(consultant !== undefined && { putTo: consultant }),
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

/** The user Work's event names, as the run keeps them. */
function holdingUserOf({ userId, name }: HoldingUser): HoldingUser {
  return { userId, name };
}

/** What holds a run left running with nothing recorded on it, by the state of its Task. */
function heldByAfterRestart({
  state,
  pausedBy,
}: Pick<StartedTask, "state" | "pausedBy">): StageInterruption {
  if (state !== "paused") return "restart";
  if (pausedBy === "usage-window") return "usage-window";
  return pausedBy === "alarm" ? "alarm" : "pause";
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
