import { Injectable } from "@nestjs/common";
import { earlierResults, stageResultWords } from "../domain/agent-stage-brief.js";
import type { Stage } from "../domain/stage.js";
import type { StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";

/** A Task's Stage results as a person's Thread on it is briefed with them (spec §2.5). */
@Injectable()
export class StageResultWords {
  constructor(
    private readonly runs: StageRunRepository,
    private readonly taskStages: TaskStagesRepository,
  ) {}

  /** Every run's result, and the Handover notes of `roleKey`'s runs, in the order they ran. */
  async of(
    taskId: string,
    roleKey: string,
  ): Promise<{ readonly lines: readonly string[]; readonly handoverNotes: readonly string[] }> {
    const [runs, taskStages] = await Promise.all([
      this.runs.list(taskId),
      this.taskStages.find(taskId),
    ]);
    const stages = taskStages?.stages ?? [];
    return {
      lines: earlierResults(stages, runs).map(stageResultWords),
      handoverNotes: handoverNotesOf(roleKey, stages, runs),
    };
  }
}

function handoverNotesOf(
  roleKey: string,
  stages: readonly Stage[],
  runs: readonly StageRun[],
): string[] {
  const own = stages.filter((stage) => stage.kind === "agent" && stage.role === roleKey);
  return runs.flatMap(({ stageKey, outcome }) => {
    const note = outcome?.handoverNote;
    return note !== undefined && own.some(({ key }) => key === stageKey) ? [note] : [];
  });
}
