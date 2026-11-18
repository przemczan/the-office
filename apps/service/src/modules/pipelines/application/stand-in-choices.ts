import { Injectable } from "@nestjs/common";
import type { StageRun, StandInChoice } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks } from "../ports/started-tasks.js";

/**
 * A Stage run held as its engine refused a turn for a used-up usage window, though a Stand-in
 * Engine had room: the session's context is over the size Settings › Engines asks first above, so
 * the Task waits Paused for the user's choice of going on there, or the window's reset (spec 5.4).
 */
export interface WaitingStandInChoice {
  readonly taskId: string;
  readonly runId: string;
  readonly stageKey: string;
  /** The run's Stage Thread, whose session would go on on the Stand-in Engine. */
  readonly threadId: string | undefined;
  /** The engine that refused the turn, by its id and its name at the time. */
  readonly fromEngineId: string | undefined;
  readonly fromEngineName: string;
  readonly standIn: StandInChoice;
  /** When the used-up window resets, as an ISO time. */
  readonly resetsAt: string;
}

/** The Stand-in Engine choices waiting on the user (spec 5.4). */
@Injectable()
export class StandInChoices {
  constructor(
    private readonly tasks: StartedTasks,
    private readonly runs: StageRunRepository,
  ) {}

  /**
   * Each Task paused by the usage window whose latest run was held with a Stand-in Engine choice; a
   * choice stops waiting once the Task resumes, at the reset or by the user.
   */
  async waiting(): Promise<WaitingStandInChoice[]> {
    const paused = (await this.tasks.list()).filter(
      ({ state, pausedBy }) => state === "paused" && pausedBy === "usage-window",
    );
    const runs = await this.runs.listOfTasks(paused.map(({ id }) => id));
    return paused.flatMap(({ id }) => {
      const choice = waitingChoiceOf(runs.filter(({ taskId }) => taskId === id).at(-1));
      return choice ? [choice] : [];
    });
  }
}

/** The choice the run waits on, when it is held with one. */
function waitingChoiceOf(run: StageRun | undefined): WaitingStandInChoice | undefined {
  const refused = run?.outcome?.status === "failed" ? run.outcome.refused : undefined;
  if (run === undefined || refused?.standInChoice === undefined) return undefined;
  return {
    taskId: run.taskId,
    runId: run.id,
    stageKey: run.stageKey,
    threadId: run.threadId,
    fromEngineId: run.engineId,
    fromEngineName: refused.engineName,
    standIn: refused.standInChoice,
    resetsAt: refused.resetsAt,
  };
}
