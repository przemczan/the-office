import { Injectable } from "@nestjs/common";
import { PromptTemplates } from "../../prompt-templates/index.js";
import { earlierResults, stageResultWords } from "../domain/agent-stage-brief.js";
import { EARLIER_STAGE_RESULT } from "../domain/agent-stage-brief-templates.js";
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

/** A Task's own Stages and its runs, outlined for an Off-board Task's card in Work. */
export interface TaskStageRunsOutline {
  readonly taskId: string;
  /** The Task's own Stage names in order; undefined before its Stages are made. */
  readonly stages: readonly string[] | undefined;
  /** In the order they ran. */
  readonly runs: readonly {
    /** Its Stage's name in the Task's Stages; its key when the Task no longer has it. */
    readonly stageName: string;
    readonly roleKey: string | undefined;
    readonly threadId: string | undefined;
    /** The failure's error of a failed run; undefined for any other. */
    readonly error: string | undefined;
    /** Its Decision on running out of tries while it waits for an answer; undefined otherwise. */
    readonly openOutOfTriesDecisionId: string | undefined;
  }[];
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
    private readonly promptTemplates: PromptTemplates,
  ) {}

  /** Every run's result, and the Handover notes of `roleKey`'s runs, in the order they ran. */
  async of(
    taskId: string,
    roleKey: string,
  ): Promise<{ readonly lines: readonly string[]; readonly handoverNotes: readonly string[] }> {
    const { stages, runs } = await this.read(taskId);
    return {
      lines: await this.linesOf(stages, runs),
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
      lines: await this.linesOf(stages, runs),
      handoverNotes: handoverNotesOf(stages, runs),
    };
  }

  /** One outline for each of `taskIds`, in their order, their runs read at once. */
  async outlinesOf(taskIds: readonly string[]): Promise<readonly TaskStageRunsOutline[]> {
    if (taskIds.length === 0) return [];
    const [runs, taskStages] = await Promise.all([
      this.runs.listOfTasks(taskIds),
      Promise.all(taskIds.map((taskId) => this.taskStages.find(taskId))),
    ]);
    return taskIds.map((taskId, index) => {
      const stages = taskStages[index]?.stages;
      const nameOf = (key: string) => stages?.find((stage) => stage.key === key)?.name ?? key;
      return {
        taskId,
        stages: stages?.map(({ name }) => name),
        runs: runs
          .filter((run) => run.taskId === taskId)
          .toSorted((one, other) => one.number - other.number)
          .map((run) => ({
            stageName: nameOf(run.stageKey),
            roleKey: run.roleKey,
            threadId: run.threadId,
            error: run.outcome?.status === "failed" ? run.outcome.error : undefined,
            openOutOfTriesDecisionId: run.decisions.find(
              ({ kind, answer }) => kind === "no-retries-left" && answer === undefined,
            )?.id,
          })),
      };
    });
  }

  /** Each run's result as a line, as the earlier Stage's result template words it now. */
  private async linesOf(stages: readonly Stage[], runs: readonly StageRun[]): Promise<string[]> {
    const prompts = await this.promptTemplates.textsOf([EARLIER_STAGE_RESULT]);
    return earlierResults(stages, runs).map((result) => stageResultWords(prompts, result));
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
