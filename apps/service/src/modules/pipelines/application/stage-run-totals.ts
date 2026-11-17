import { Injectable } from "@nestjs/common";
import { StageRunRepository, type StartedStageRun } from "../ports/stage-run-repository.js";

/** The Stage runs started since a moment, across every Task, for the basic stats (spec 2.11). */
@Injectable()
export class StageRunTotals {
  constructor(private readonly runs: StageRunRepository) {}

  /** Each run started at or after `since`, with its tokens and whether it retried its Stage. */
  since(since: Date): Promise<readonly StartedStageRun[]> {
    return this.runs.startedSince(since);
  }
}
