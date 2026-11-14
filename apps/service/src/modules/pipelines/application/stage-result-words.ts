import { Injectable } from "@nestjs/common";
import { earlierResults, stageResultWords } from "../domain/agent-stage-brief.js";
import type { Stage } from "../domain/stage.js";
import type { StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";

/** A Handover note with the Stage and the Role whose person wrote it. */
export interface HandoverNoteWords {
  readonly stageName: string;
  readonly roleKey: string;
  readonly note: string;
}

/**
 * A Task's Stage results, as a person's Thread on it is briefed with them (spec §2.5) and as an
 * Agent reads the Task's record.
 */
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
    const { stages, runs } = await this.read(taskId);
    return {
      lines: earlierResults(stages, runs).map(stageResultWords),
      handoverNotes: handoverNotesOf(stages, runs)
        .filter((handover) => handover.roleKey === roleKey)
        .map(({ note }) => note),
    };
  }

  /** Every run's result, and every Handover note with its Stage and Role, in the order they ran. */
  async ofTask(taskId: string): Promise<{
    readonly lines: readonly string[];
    readonly handoverNotes: readonly HandoverNoteWords[];
  }> {
    const { stages, runs } = await this.read(taskId);
    return {
      lines: earlierResults(stages, runs).map(stageResultWords),
      handoverNotes: handoverNotesOf(stages, runs),
    };
  }

  private async read(
    taskId: string,
  ): Promise<{ readonly stages: readonly Stage[]; readonly runs: readonly StageRun[] }> {
    const [runs, taskStages] = await Promise.all([
      this.runs.list(taskId),
      this.taskStages.find(taskId),
    ]);
    return { stages: taskStages?.stages ?? [], runs };
  }
}

function handoverNotesOf(stages: readonly Stage[], runs: readonly StageRun[]): HandoverNoteWords[] {
  return runs.flatMap(({ stageKey, outcome, roleKey }) => {
    const note = outcome?.handoverNote;
    const stage = stages.find(({ key }) => key === stageKey);
    if (note === undefined || stage?.kind !== "agent") return [];
    // A run kept before its Role was recorded named its Stage's Role.
    const wroteIt = roleKey ?? stage.role;
    return wroteIt === undefined ? [] : [{ stageName: stage.name, roleKey: wroteIt, note }];
  });
}
