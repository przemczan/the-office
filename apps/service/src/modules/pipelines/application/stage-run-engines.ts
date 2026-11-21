import { Injectable } from "@nestjs/common";
import { StageRunRepository, type KeptStageRunEngines } from "../ports/stage-run-repository.js";

/** The engines each Stage run of some Tasks ran on, for the full stats' most expensive (spec 2.11). */
@Injectable()
export class StageRunEngines {
  constructor(private readonly runs: StageRunRepository) {}

  /** Each run of the Tasks that kept an engine, each Task's oldest first. */
  of(taskIds: readonly string[]): Promise<readonly KeptStageRunEngines[]> {
    return this.runs.enginesOfTasks(taskIds);
  }
}
