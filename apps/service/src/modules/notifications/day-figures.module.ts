import { Module } from "@nestjs/common";
import { PostgresOfficeDayFigures } from "./adapters/postgres/postgres-office-day-figures.js";
import { PostgresTaskOutcomeRepository } from "./adapters/postgres/postgres-task-outcome-repository.js";
import { DayFigures } from "./application/day-figures.js";
import { OfficeDayFigures } from "./ports/office-day-figures.js";
import { TaskOutcomeRepository } from "./ports/task-outcome-repository.js";

/**
 * The day's counts and the Tasks' outcomes alone, which Work's Days reads: the rest of
 * Notifications calls Work, so Work must not import NotificationsModule. NotificationsModule keeps
 * them as events come through the repositories exported here.
 */
@Module({
  providers: [
    { provide: TaskOutcomeRepository, useClass: PostgresTaskOutcomeRepository },
    { provide: OfficeDayFigures, useClass: PostgresOfficeDayFigures },
    DayFigures,
  ],
  exports: [TaskOutcomeRepository, OfficeDayFigures, DayFigures],
})
export class DayFiguresModule {}
