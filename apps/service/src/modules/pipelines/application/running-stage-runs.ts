import { Injectable } from "@nestjs/common";
import { StageRunRepository, type RanAgentStageRun } from "../ports/stage-run-repository.js";

/** The Agent Stage runs that ran in a range, across every Task, for the full stats (spec 2.11). */
@Injectable()
export class RunningStageRuns {
  constructor(private readonly runs: StageRunRepository) {}

  /** Each Agent Stage run that ran at some time between `from` and `to`, oldest first. */
  between(from: Date, to: Date): Promise<readonly RanAgentStageRun[]> {
    return this.runs.ranBetween(from, to);
  }
}
