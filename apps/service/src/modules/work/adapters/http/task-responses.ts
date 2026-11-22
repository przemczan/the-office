import { Injectable } from "@nestjs/common";
import type {
  Task as TaskResponse,
  TaskSummary as TaskSummaryResponse,
} from "@the-office/contracts";
import type { EngineModel } from "../../../engine/index.js";
import type { Task, TaskSummary } from "../../domain/task.js";
import { InitiativeRepository } from "../../ports/initiative-repository.js";
import { toTaskResponse, toTaskSummaryResponse } from "./work-responses.js";

/**
 * A Task as the routes answer it, with its Initiative's engine (spec 5.4.5), which it runs on
 * while it sets none: read once per Initiative however many of its Tasks are answered.
 */
@Injectable()
export class TaskResponses {
  constructor(private readonly initiatives: InitiativeRepository) {}

  async task(task: Task): Promise<TaskResponse> {
    return toTaskResponse(task, (await this.initiativeEngines([task])).get(task.id) ?? null);
  }

  /** What answers each of `tasks`, their Initiatives read once beforehand. */
  async responder(tasks: readonly Task[]): Promise<(task: Task) => TaskResponse> {
    const engines = await this.initiativeEngines(tasks);
    return (task) => toTaskResponse(task, engines.get(task.id) ?? null);
  }

  async summaries(tasks: readonly TaskSummary[]): Promise<TaskSummaryResponse[]> {
    const engines = await this.initiativeEngines(tasks);
    return tasks.map((task) => toTaskSummaryResponse(task, engines.get(task.id) ?? null));
  }

  /** Each Task's Initiative's engine, by the Task's id; none for a Task in no Initiative. */
  private async initiativeEngines(
    tasks: readonly Pick<TaskSummary, "id" | "initiativeId">[],
  ): Promise<ReadonlyMap<string, EngineModel | null>> {
    const ids = [...new Set(tasks.flatMap(({ initiativeId }) => initiativeId ?? []))];
    const read = await Promise.all(ids.map((id) => this.initiatives.find(id)));
    const engines = new Map(ids.map((id, at) => [id, read[at]?.engine ?? null] as const));
    return new Map(
      tasks.map(({ id, initiativeId }) => [
        id,
        initiativeId === undefined ? null : (engines.get(initiativeId) ?? null),
      ]),
    );
  }
}
