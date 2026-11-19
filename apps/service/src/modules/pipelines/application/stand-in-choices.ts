import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EngineSessions, type EngineModel } from "../../engine/index.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskPaused, TaskResumed, TaskStateChanged, TaskStopped } from "../../work/index.js";
import { walkedStages } from "../domain/resolve-stages.js";
import type { StageRun, StageRunStandIn, StandInChoice } from "../domain/stage-run.js";
import { StandInChoicesChanged, StageRunEnded } from "../domain/stage-run-events.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks, type StartedTask } from "../ports/started-tasks.js";
import { TaskRecords } from "../ports/task-records.js";
import { TaskStagesService } from "./task-stages-service.js";

/**
 * A Stage run held as its engine refused a turn for a used-up usage window, though a Stand-in
 * Engine had room: the session's context is over the size Settings › Engines asks first above, so
 * the Task waits Paused for the user's choice of going on on a Stand-in Engine now, or the window's
 * reset (spec 5.4). Worked out from the held run on each read; nothing else keeps it.
 */
export interface HeldForStandInChoice {
  readonly taskId: string;
  readonly runId: string;
  readonly stageKey: string;
  /** The run's Stage Thread, whose session would go on on the Stand-in Engine. */
  readonly threadId: string | undefined;
  /** The engine that refused the turn, by its id and its name at the time, and the model. */
  readonly fromEngineId: string | undefined;
  readonly fromEngineName: string;
  readonly model: string | undefined;
  /** The cascade's engine the run's engine stood in for, when it was a stand-in already. */
  readonly standInFor: StageRunStandIn | undefined;
  /** The Stand-in Engine that had room as the run was held, and why the user is asked. */
  readonly asked: StandInChoice;
  /** The used-up window, by the engine module's name ("unknown" for runs held before it was kept). */
  readonly window: string;
  /** The window's words, and its reset as an ISO time. */
  readonly windowWords: string;
  readonly resetsAt: string;
  /** Since when it waits: the held run's end. */
  readonly waitingSince: Date;
}

/** A Stage waiting for the user's choice, as the card in Needs you lists it. */
export interface WaitingStandInChoice extends HeldForStandInChoice {
  readonly taskTitle: string;
  readonly projectId: string;
  readonly stageName: string;
  /** The Stand-in Engine it would move to now, the first with room; null while none has room. */
  readonly standInNow: { readonly engineId: string; readonly engineName: string } | null;
}

/**
 * The Stages waiting for the user's choice of a Stand-in Engine (spec 5.4), The Office's own
 * Decision in Needs you: each Task Paused by the usage window whose latest run was held with a
 * Stand-in Engine choice the user hasn't made. A Stage that pauses so joins, a Task resumed (at the
 * reset or by hand), stopped or dropped leaves, and the card is gone once none is left. Tells of
 * each such change with `StandInChoicesChanged`.
 */
@Injectable()
export class StandInChoices implements OnModuleInit {
  constructor(
    private readonly tasks: StartedTasks,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly taskStages: TaskStagesService,
    private readonly engineSessions: EngineSessions,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    // The held run's end is saved after the Stage runner paused the Task, so the row joins then.
    this.events.subscribe(StageRunEnded, ({ taskId, status }) =>
      status === "failed" ? this.toldIfAsked(taskId) : undefined,
    );
    this.events.subscribe(TaskResumed, ({ taskId }) => this.toldIfAsked(taskId));
    this.events.subscribe(TaskStopped, ({ taskId }) => this.toldIfAsked(taskId));
    this.events.subscribe(TaskPaused, ({ taskId, by }) =>
      by === "usage-window" ? undefined : this.toldIfAsked(taskId),
    );
    this.events.subscribe(TaskStateChanged, ({ taskId, to }) =>
      to === "dropped" ? this.toldIfAsked(taskId) : undefined,
    );
  }

  /** Every Stage waiting for the choice, oldest first, each with the Stand-in Engine it would move to now. */
  async waiting(): Promise<WaitingStandInChoice[]> {
    const held = await this.held();
    return Promise.all(held.map(({ task, choice }) => this.withWords(task, choice)));
  }

  /**
   * The held run `runId` while it still waits for the user's choice, and its Task; undefined once it
   * doesn't: its Task resumed, stopped or dropped, a later run began, or the choice was made.
   */
  async stillWaiting(
    runId: string,
  ): Promise<{ readonly task: StartedTask; readonly choice: HeldForStandInChoice } | undefined> {
    return (await this.held()).find(({ choice }) => choice.runId === runId);
  }

  /** The Stand-in Engine a held run's session would move to now; null while none has room. */
  async standInNow(choice: HeldForStandInChoice): Promise<EngineModel | null> {
    if (choice.fromEngineId === undefined || choice.model === undefined) return null;
    return this.engineSessions.standInFor({ engineId: choice.fromEngineId, model: choice.model });
  }

  private async held(): Promise<
    { readonly task: StartedTask; readonly choice: HeldForStandInChoice }[]
  > {
    const paused = (await this.tasks.list()).filter(pausedByTheWindow);
    if (paused.length === 0) return [];
    const runs = await this.runs.listOfTasks(paused.map(({ id }) => id));
    return paused
      .flatMap((task) => {
        const choice = heldForChoice(runs.filter(({ taskId }) => taskId === task.id).at(-1));
        return choice ? [{ task, choice }] : [];
      })
      .toSorted(
        (one, other) => one.choice.waitingSince.getTime() - other.choice.waitingSince.getTime(),
      );
  }

  private async withWords(
    task: StartedTask,
    choice: HeldForStandInChoice,
  ): Promise<WaitingStandInChoice> {
    const [record, stageName, standIn] = await Promise.all([
      this.records.read(task.id),
      this.stageNameOf(choice),
      this.standInNow(choice),
    ]);
    return {
      ...choice,
      taskTitle: record.title,
      projectId: task.projectId,
      stageName,
      standInNow: standIn && {
        engineId: standIn.engineId,
        engineName: await this.engineSessions.nameOf(standIn.engineId),
      },
    };
  }

  private async stageNameOf({ taskId, stageKey }: HeldForStandInChoice): Promise<string> {
    const own = await this.taskStages.find(taskId);
    if (!own) return stageKey;
    const stages = walkedStages(own.stages, await this.runs.listOfTasks([taskId]));
    return stages.find(({ key }) => key === stageKey)?.name ?? stageKey;
  }

  /**
   * Tells the choices may have changed when a run of the Task was held asking one: any, not only
   * the latest, as the walk may already have begun the next run in the background.
   */
  private async toldIfAsked(taskId: string): Promise<void> {
    const runs = await this.runs.listOfTasks([taskId]);
    if (runs.some(askedChoice)) await this.events.publish(new StandInChoicesChanged(taskId));
  }
}

function pausedByTheWindow({ state, pausedBy }: StartedTask): boolean {
  return state === "paused" && pausedBy === "usage-window";
}

/** Whether the run was held asking the user's choice of a Stand-in Engine, made or not. */
function askedChoice(run: StageRun | undefined): boolean {
  return run?.outcome?.status === "failed" && run.outcome.refused?.standInChoice !== undefined;
}

/** The choice the run waits on: held asking it, and not yet chosen. */
export function heldForChoice(run: StageRun | undefined): HeldForStandInChoice | undefined {
  const refused = run?.outcome?.status === "failed" ? run.outcome.refused : undefined;
  if (run === undefined || refused?.standInChoice === undefined) return undefined;
  if (run.engineSwitches.some(({ chosenBy }) => chosenBy !== undefined)) return undefined;
  return {
    taskId: run.taskId,
    runId: run.id,
    stageKey: run.stageKey,
    threadId: run.threadId,
    fromEngineId: run.engineId,
    fromEngineName: refused.engineName,
    model: run.model,
    standInFor: run.standInFor,
    asked: refused.standInChoice,
    window: refused.window ?? "unknown",
    windowWords: refused.windowWords,
    resetsAt: refused.resetsAt,
    waitingSince: run.endedAt ?? run.startedAt,
  };
}
