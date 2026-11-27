import { Injectable } from "@nestjs/common";
import { officeDayBounds } from "../../../platform/office-day.js";
import { latestPerTask } from "../domain/task-outcome.js";
import { OfficeDayFigures } from "../ports/office-day-figures.js";
import { TaskOutcomeRepository } from "../ports/task-outcome-repository.js";
import type { TokenKinds } from "../domain/office-day.js";

/** A Task that failed for good in a day, by its id; the Stage when one was named. */
export interface FailedTaskOnDay {
  readonly taskId: string;
  readonly stageName: string | undefined;
  readonly at: Date;
}

/**
 * What a day's counts say, as ids and figures for Work's Days: the tokens counted that day and the
 * Tasks that failed in it. Never a Task's details, which are Work's.
 */
@Injectable()
export class DayFigures {
  constructor(
    private readonly figures: OfficeDayFigures,
    private readonly outcomes: TaskOutcomeRepository,
  ) {}

  /** Every kind of the office day's tokens, Office-wide. */
  tokens(day: string): Promise<TokenKinds> {
    return this.figures.tokensOn(day);
  }

  /** The Tasks that failed in the office day, each at its latest failure, newest first. */
  async failedTasks(day: string): Promise<readonly FailedTaskOnDay[]> {
    const bounds = officeDayBounds(day);
    if (!bounds) return [];
    const failed = await this.outcomes.failedBetween(bounds.start, bounds.end);
    return latestPerTask(failed).map(({ taskId, stageName, occurredAt }) => ({
      taskId,
      stageName,
      at: occurredAt,
    }));
  }
}
