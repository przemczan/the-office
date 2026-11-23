import { Injectable, Logger } from "@nestjs/common";
import { EngineSessions, type EngineModel } from "../../engine/index.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskLocks } from "../../../platform/locks/task-locks.js";
import type { HoldingUser } from "../domain/stage-run.js";
import { engineSwitched, type NamedEngine } from "../domain/stage-run-changes.js";
import { StandInChoicesChanged } from "../domain/stage-run-events.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads } from "../ports/stage-threads.js";
import { StartedTasks, type StartedTask } from "../ports/started-tasks.js";
import { StandInChoices, type HeldForStandInChoice } from "./stand-in-choices.js";

/** What came of one held run's switch, as the contract's `StandInSwitchOutcome` names them. */
export type StandInSwitchOutcome =
  "switched" | "already-resumed" | "no-longer-waiting" | "no-room" | "failed" | "moved-not-resumed";

/** One held run's switch: what came of it, and the words the card shows beside its Stage. */
export interface StandInSwitchResult {
  readonly runId: string;
  readonly outcome: StandInSwitchOutcome;
  readonly words: string;
}

/**
 * The user's Switch now on Stages waiting for their choice of a Stand-in Engine (spec 5.4): each
 * Task on its own, under the Task's lock that its resume at the reset takes too, so one Stage
 * failing never holds the others back and a click during the reset finds the Task already resumed.
 */
@Injectable()
export class StandInSwitches {
  private readonly logger = new Logger(StandInSwitches.name);

  constructor(
    private readonly choices: StandInChoices,
    private readonly threads: StageThreads,
    private readonly tasks: StartedTasks,
    private readonly runs: StageRunRepository,
    private readonly engineSessions: EngineSessions,
    private readonly locks: TaskLocks,
    private readonly events: EventBus,
  ) {}

  /**
   * Switches each held run in `runIds`, each with its own result, one after another in the order
   * given, so each picks the Stand-in Engine with room once the switches before it have moved.
   */
  async switch(runIds: readonly string[], user: HoldingUser): Promise<StandInSwitchResult[]> {
    const results: StandInSwitchResult[] = [];
    for (const runId of new Set(runIds)) {
      results.push({ runId, ...(await this.switchOneSafely(runId, user)) });
    }
    return results;
  }

  /** One run's switch, whose unforeseen failure is its own result and never the others'. */
  private async switchOneSafely(
    runId: string,
    user: HoldingUser,
  ): Promise<Omit<StandInSwitchResult, "runId">> {
    try {
      return await this.switchOne(runId, user);
    } catch (error) {
      this.logger.warn(`Stage run ${runId} couldn't switch: ${messageOf(error)}`);
      return { outcome: "failed", words: `It couldn't switch: ${messageOf(error)}.` };
    }
  }

  private async switchOne(
    runId: string,
    user: HoldingUser,
  ): Promise<Omit<StandInSwitchResult, "runId">> {
    const taskId = await this.runs.taskOf(runId);
    if (taskId === undefined) return NOT_WAITING;
    const result = await this.locks.run(taskId, async () => {
      const waiting = await this.choices.stillWaiting(runId);
      if (!waiting) return this.noLongerWaiting(taskId, runId);
      return this.switchHeld(waiting, user);
    });
    await this.events.publish(new StandInChoicesChanged(taskId));
    return result;
  }

  /** Why a run no longer waits: its Task resumed (at the reset or by hand), or was stopped or ended. */
  private async noLongerWaiting(
    taskId: string,
    runId: string,
  ): Promise<Omit<StandInSwitchResult, "runId">> {
    const [task, runs] = await Promise.all([this.tasks.find(taskId), this.runs.list(taskId)]);
    const held = runs.find(({ id }) => id === runId);
    const chosen = held?.engineSwitches.findLast(({ chosenBy }) => chosenBy !== undefined);
    if (chosen) {
      return {
        outcome: "no-longer-waiting",
        words: `It was already switched to ${chosen.toEngineName}.`,
      };
    }
    if (task && goesOn(task)) {
      return {
        outcome: "already-resumed",
        words: `It already went on on ${held?.engineName ?? "its own Engine"}, as its Task resumed.`,
      };
    }
    return task?.state === "dropped" ? DROPPED : NOT_WAITING;
  }

  /** Steps 2 to 6 of the switch, for a run still waiting under its Task's lock. */
  private async switchHeld(
    { task, choice }: { readonly task: StartedTask; readonly choice: HeldForStandInChoice },
    user: HoldingUser,
  ): Promise<Omit<StandInSwitchResult, "runId">> {
    const waitsWords = `it waits for the reset at ${resetWords(choice.resetsAt)}`;
    const standIn = await this.choices.standInNow(choice, task.projectId);
    if (!standIn) {
      return { outcome: "no-room", words: `No Stand-in Engine has room now; ${waitsWords}.` };
    }
    const to = {
      engineId: standIn.engineId,
      engineName: await this.engineSessions.nameOf(standIn.engineId),
    };
    try {
      await this.move(choice, standIn);
    } catch (error) {
      this.logger.warn(
        `Stage run ${choice.runId}'s session couldn't move to ${to.engineName}: ${messageOf(error)}`,
      );
      return {
        outcome: "failed",
        words: `Its session couldn't move to ${to.engineName}: ${messageOf(error)}. It stays on ${choice.fromEngineName}, and ${waitsWords}.`,
      };
    }
    // The session is on the stand-in now: a failure from here on never moves it back.
    try {
      await this.record(choice, to, user);
      await this.tasks.resume(choice.taskId, { kind: "user", user });
    } catch (error) {
      this.logger.warn(
        `Stage run ${choice.runId}'s Task didn't resume on ${to.engineName}: ${messageOf(error)}`,
      );
      return {
        outcome: "moved-not-resumed",
        words: `Its session is on ${to.engineName} now, but it couldn't go on: ${messageOf(error)}. Resume the Task to go on there.`,
      };
    }
    return { outcome: "switched", words: `It goes on on ${to.engineName}.` };
  }

  private async move(choice: HeldForStandInChoice, standIn: EngineModel): Promise<void> {
    if (choice.threadId === undefined || choice.fromEngineId === undefined) {
      throw new Error("The Stage has no session to move.");
    }
    await this.threads.moveToStandIn(choice.threadId, standIn, {
      from: choice.fromEngineId,
      window: choice.window,
      resetsAt: new Date(choice.resetsAt),
    });
  }

  /**
   * Records the switch on the Task, so its later Stages open on `to`, and on the held run, with who
   * chose it, so the run leaves the card; then tells of it.
   */
  private async record(
    choice: HeldForStandInChoice,
    to: NamedEngine,
    user: HoldingUser,
  ): Promise<void> {
    const cascade: NamedEngine = choice.standInFor ?? {
      engineId: choice.fromEngineId ?? "",
      engineName: choice.fromEngineName,
    };
    const { engineSwitch, standInFor, event } = engineSwitched(
      { id: choice.runId, taskId: choice.taskId, stageKey: choice.stageKey },
      {
        from: { engineId: choice.fromEngineId ?? "", engineName: choice.fromEngineName },
        to,
        cascade,
        windowWords: choice.windowWords,
        resetsAt: new Date(choice.resetsAt),
      },
      new Date(),
    );
    await this.tasks.wentOnOnStandIn(choice.taskId, {
      engineId: cascade.engineId,
      engineName: cascade.engineName,
      standInId: to.engineId,
      standInName: to.engineName,
      reason: standInFor.reason,
      short: `${choice.windowWords} used up`,
    });
    const onItsOwn = to.engineId === cascade.engineId;
    await this.runs.saveEngineSwitch(
      choice.runId,
      { ...engineSwitch, chosenBy: user },
      { ...to, standInFor: onItsOwn ? undefined : standInFor },
    );
    await this.events.publish(event);
  }
}

const NOT_WAITING: Omit<StandInSwitchResult, "runId"> = {
  outcome: "no-longer-waiting",
  words: "It no longer waits for this choice: its Task was resumed, paused or stopped by hand.",
};

const DROPPED: Omit<StandInSwitchResult, "runId"> = {
  outcome: "no-longer-waiting",
  words: "It no longer waits for this choice: its Task was dropped.",
};

/** Whether the Task goes on: In progress or Waiting on you, its Pipeline walking again. */
function goesOn({ state }: StartedTask): boolean {
  return state === "in-progress" || state === "waiting-on-you";
}

/** "2026-11-13 14:00 UTC", as a Stage Thread's line words a reset. */
function resetWords(resetsAt: string): string {
  return `${resetsAt.slice(0, 10)} ${resetsAt.slice(11, 16)} UTC`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
