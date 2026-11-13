import { Injectable } from "@nestjs/common";
import { lastActedOnGateRun } from "../domain/gate.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";

/** A Task's Gate runs, as Work weighs an Agent's Attachments by them (spec §2.1). */
@Injectable()
export class TaskGateRuns {
  constructor(private readonly runs: StageRunRepository) {}

  /** When the last Gate run on the Task the user acted on ended; undefined before any. */
  async lastActedOnGateEnd(taskId: string): Promise<Date | undefined> {
    return lastActedOnGateRun(await this.runs.list(taskId))?.endedAt;
  }
}
