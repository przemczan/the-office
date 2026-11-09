import { Injectable } from "@nestjs/common";
import { walkedStages } from "../domain/resolve-stages.js";
import { stageHistoryWords, stageRunWords } from "../domain/stage-history-words.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";

/**
 * A Task's Stage history in words, for a person's session to diagnose its runs with (spec §2.3):
 * read from the Stage run records alone, so it names no file under the Office data directory.
 */
@Injectable()
export class StageHistory {
  constructor(
    private readonly runs: StageRunRepository,
    private readonly taskStages: TaskStagesRepository,
  ) {}

  /** Every run of the Task, in the order they ran, each command with its filtered output. */
  async of(taskId: string): Promise<string> {
    const [runs, own] = await Promise.all([this.runs.list(taskId), this.taskStages.find(taskId)]);
    if (!own && runs.length === 0) return noStagesWords(taskId);
    return stageHistoryWords(walkedStages(own?.stages ?? [], runs), runs);
  }

  /** The Task's run of that number, each command with its whole output. */
  async run(taskId: string, runNumber: number): Promise<string> {
    const [runs, own] = await Promise.all([this.runs.list(taskId), this.taskStages.find(taskId)]);
    if (!own && runs.length === 0) return noStagesWords(taskId);
    const run = runs.find(({ number }) => number === runNumber);
    if (!run) return noRunWords(runNumber, runs.length);
    const outputs = (await this.runs.commandOutputs(taskId, run.id)) ?? [];
    return stageRunWords(walkedStages(own?.stages ?? [], runs), run, outputs);
  }
}

function noStagesWords(taskId: string): string {
  return `The Task ${taskId} has no Stage runs: it hasn't started, or The Office has no Task of that id. list_tasks lists the Tasks with their ids.`;
}

function noRunWords(runNumber: number, runCount: number): string {
  return runCount === 0
    ? `The Task has no run ${runNumber}, as it has no Stage runs yet.`
    : `The Task has no run ${runNumber}: its runs are numbered 1 to ${runCount}.`;
}
