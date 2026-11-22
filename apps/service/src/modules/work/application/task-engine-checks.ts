import { Injectable } from "@nestjs/common";
import type { EngineModel } from "../../engine/index.js";
import type { Task } from "../domain/task.js";
import { onTask, pipelineChoiceMoves, type TaskEngineChange } from "../domain/work-engine.js";
import type { InitiativeRepository } from "../ports/initiative-repository.js";

export type { TaskEngineChange, TaskEngineLevels, TaskEngineMove } from "../domain/work-engine.js";

/** Every reason, in the UI's words, the change can't be saved; none lets it through. */
export type TaskEngineCheck = (change: TaskEngineChange) => Promise<readonly string[]>;

/**
 * What refuses a change of Tasks' engines, registered by Pipelines, which knows the Roles each
 * Task's Stages name: Pipelines reads Tasks through Work, so Work can't ask it directly (the module
 * template's registry). With none registered, every change passes.
 */
@Injectable()
export class TaskEngineChecks {
  private readonly checks: TaskEngineCheck[] = [];

  register(check: TaskEngineCheck): void {
    this.checks.push(check);
  }

  async problemsOf(change: TaskEngineChange): Promise<readonly string[]> {
    if (change.moves.length === 0) return [];
    const problems = await Promise.all(this.checks.map((check) => check(change)));
    return problems.flat();
  }
}

/**
 * Why choosing `pipelineId` for the Task would put a Role its Stages name on an engine that can't
 * work them (spec 5.4.5): weighed while the Task, or its Initiative, sets an engine, "On “<Task>”".
 */
export async function pipelineChoiceProblems(
  checks: TaskEngineChecks,
  initiatives: Pick<InitiativeRepository, "find">,
  task: Task,
  pipelineId: string,
): Promise<readonly string[]> {
  const initiativeEngine: EngineModel | null =
    task.initiativeId === undefined
      ? null
      : ((await initiatives.find(task.initiativeId))?.engine ?? null);
  return checks.problemsOf({
    place: onTask(task),
    moves: pipelineChoiceMoves(task, initiativeEngine, pipelineId),
  });
}
