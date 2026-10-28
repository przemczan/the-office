import { Module } from "@nestjs/common";
import { Schedule } from "./schedule.js";
import { TimerSchedule } from "./timer-schedule.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Imported by each module that runs a job of its own; tests replace `Schedule`. */
@Module({
  providers: [{ provide: Schedule, useFactory: () => new TimerSchedule(DAY_MS) }],
  exports: [Schedule],
})
export class ScheduleModule {}
