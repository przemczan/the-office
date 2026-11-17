import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  STATS_DAYS,
  weekStartOf,
  weekStatsOf,
  type StatsProjectFilter,
  type WeekStats,
} from "../domain/basic-stats.js";
import { DayTokens, type StatsDay } from "../ports/day-tokens.js";
import { EngineWindows, type StatsEngine } from "../ports/engine-windows.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { StageRunTotals } from "../ports/stage-run-totals.js";

/** The basic stats (spec 2.11), from what The Office already keeps. */
export interface BasicStatsRead extends WeekStats {
  /** The last 30 office days, oldest first, ending today; Office-wide. */
  readonly days: readonly StatsDay[];
  /** The start of the office day that is this week's Monday. */
  readonly weekStartsAt: Date;
  /** Every engine, in Settings › Engines' order; Office-wide. */
  readonly engines: readonly StatsEngine[];
}

/** Reads the basic stats afresh on each read, as the page asks every minute. */
@Injectable()
export class BasicStats {
  constructor(
    private readonly schedule: Schedule,
    private readonly dayTokens: DayTokens,
    private readonly engineWindows: EngineWindows,
    private readonly stageRuns: StageRunTotals,
    private readonly tasks: OfficeTasks,
  ) {}

  /** Tokens per day and the engines are Office-wide; the week's Task figures follow `filter`. */
  async read(filter: StatsProjectFilter): Promise<BasicStatsRead> {
    const now = this.schedule.now();
    const weekStartsAt = weekStartOf(now);
    const [days, engines, runs, doneTaskIds] = await Promise.all([
      this.dayTokens.lastDays(STATS_DAYS, now),
      this.engineWindows.list(),
      this.stageRuns.since(weekStartsAt),
      this.tasks.doneSince(weekStartsAt),
    ]);
    const taskIds = [...new Set([...runs.map(({ taskId }) => taskId), ...doneTaskIds])];
    const tasks = await this.tasks.findAll(taskIds);
    return {
      days,
      weekStartsAt,
      engines,
      ...weekStatsOf({ runs, doneTaskIds, tasks, filter }),
    };
  }
}
