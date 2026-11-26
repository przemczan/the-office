import { Injectable } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { TASK_STATE_NAMES } from "../../work/index.js";
import { asFlow } from "../domain/flow.js";
import { routesFollowed } from "../domain/pipeline-walk.js";
import type { StageRun } from "../domain/stage-run.js";
import {
  stageHistoryWords,
  stageRunThreadRoom,
  stageRunWords,
} from "../domain/stage-history-words.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreadMessages, type StageRunThreadWindow } from "../ports/stage-thread-messages.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";

/**
 * A Task's Stage history in words, for a person's session to diagnose its runs with (spec §2.3):
 * read from the Stage run records and the Stage Threads' messages alone, so it names no file under
 * the Office data directory and reads no engine transcript.
 */
@Injectable()
export class StageHistory {
  constructor(
    private readonly runs: StageRunRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly tasks: StartedTasks,
    private readonly threadMessages: StageThreadMessages,
  ) {}

  /**
   * Every run of the Task, in the order they ran, each command with its filtered output and each
   * Agent Stage's run with how many messages its Stage Thread logged.
   */
  async of(taskId: string): Promise<string> {
    const [runs, own] = await Promise.all([this.runs.list(taskId), this.taskStages.find(taskId)]);
    if (!own && runs.length === 0) return this.notStartedWords(taskId);
    const windows = runs.flatMap((run) => {
      const window = threadWindow(taskId, run);
      return window ? [{ runId: run.id, window }] : [];
    });
    const counts = await readEach(
      windows,
      async ({ runId, window }) => [runId, await this.threadMessages.count(window)] as const,
    );
    return stageHistoryWords(asFlow(own?.stages ?? []), runs, new Map(counts));
  }

  /**
   * The Task's run of that number, each command with its whole output, and an Agent Stage's run
   * with its Stage Thread's messages from its start to its end.
   */
  async run(taskId: string, runNumber: number): Promise<string> {
    const [runs, own] = await Promise.all([this.runs.list(taskId), this.taskStages.find(taskId)]);
    if (!own && runs.length === 0) return this.notStartedWords(taskId);
    const run = runs.find(({ number }) => number === runNumber);
    if (!run) return noRunWords(runNumber, runs.length);
    const stages = asFlow(own?.stages ?? []);
    const outputs = (await this.runs.commandOutputs(taskId, run.id)) ?? [];
    const route = routesFollowed(stages, runs).get(run.id);
    const window = threadWindow(taskId, run);
    const room = stageRunThreadRoom(stages, run, outputs, route);
    const threadWords = window && (await this.threadMessages.words(window, room));
    return stageRunWords(stages, run, outputs, threadWords, route);
  }

  /** A Task with no own Stages and no runs: one The Office has no record of, or one not started. */
  private async notStartedWords(taskId: string): Promise<string> {
    const task = await this.tasks.find(taskId);
    if (!task)
      return `The Office has no Task ${taskId}. list_tasks lists the Tasks with their ids.`;
    return `The Task ${taskId} hasn't started: it is in ${stateName(task.state)}, so no Stage has run yet.`;
  }
}

/** The window an Agent Stage's run logged its Stage Thread's messages in; none without a Thread. */
function threadWindow(taskId: string, run: StageRun): StageRunThreadWindow | undefined {
  if (run.threadId === undefined) return undefined;
  return { taskId, threadId: run.threadId, from: run.startedAt, to: run.endedAt ?? new Date() };
}

/** The state as the board names it. */
function stateName(state: string): string {
  const names: Readonly<Record<string, string>> = TASK_STATE_NAMES;
  return names[state] ?? state;
}

function noRunWords(runNumber: number, runCount: number): string {
  return runCount === 0
    ? `The Task has no run ${runNumber}, as it has no Stage runs yet.`
    : `The Task has no run ${runNumber}: its runs are numbered 1 to ${runCount}.`;
}
