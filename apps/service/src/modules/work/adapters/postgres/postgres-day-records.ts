import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt, notExists, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DayRecords, type DayRange, type DayRecordMoment } from "../../ports/day-records.js";
import { ideas, initiatives, taskStateChanges, tasks } from "./work.schema.js";

@Injectable()
export class PostgresDayRecords extends DayRecords {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  tasksDone(range: DayRange): Promise<readonly DayRecordMoment[]> {
    return this.movedTo("done", range);
  }

  tasksDropped(range: DayRange): Promise<readonly DayRecordMoment[]> {
    return this.movedTo("dropped", range);
  }

  async tasksStarted({ start, end }: DayRange): Promise<readonly DayRecordMoment[]> {
    const earlier = this.database.$with("earlier").as(
      this.database
        .select({ taskId: taskStateChanges.taskId })
        .from(taskStateChanges)
        .where(
          and(eq(taskStateChanges.toState, "in-progress"), lt(taskStateChanges.changedAt, start)),
        ),
    );
    const rows = await this.database
      .with(earlier)
      .select({
        id: taskStateChanges.taskId,
        at: sql<Date>`min(${taskStateChanges.changedAt})`.mapWith(taskStateChanges.changedAt),
      })
      .from(taskStateChanges)
      .where(
        and(
          eq(taskStateChanges.toState, "in-progress"),
          gte(taskStateChanges.changedAt, start),
          lt(taskStateChanges.changedAt, end),
          notExists(
            this.database
              .select({ one: sql`1` })
              .from(earlier)
              .where(eq(earlier.taskId, taskStateChanges.taskId)),
          ),
        ),
      )
      .groupBy(taskStateChanges.taskId)
      .orderBy(desc(sql`min(${taskStateChanges.changedAt})`));
    return rows;
  }

  async pullRequestsMerged({ start, end }: DayRange): Promise<readonly DayRecordMoment[]> {
    const mergedAt = sql<Date>`(${tasks.pullRequestEnd}->>'at')::timestamptz`;
    const rows = await this.database
      .select({ id: tasks.id, at: mergedAt.mapWith(tasks.createdAt) })
      .from(tasks)
      .where(
        and(
          sql`${tasks.pullRequestEnd}->>'outcome' = 'merged'`,
          sql`${mergedAt} >= ${start.toISOString()}::timestamptz`,
          sql`${mergedAt} < ${end.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(desc(mergedAt));
    return rows;
  }

  async initiativesDone({ start, end }: DayRange): Promise<readonly DayRecordMoment[]> {
    const rows = await this.database
      .select({ id: initiatives.id, at: initiatives.endedAt })
      .from(initiatives)
      .where(
        and(
          eq(initiatives.state, "done"),
          gte(initiatives.endedAt, start),
          lt(initiatives.endedAt, end),
        ),
      )
      .orderBy(desc(initiatives.endedAt));
    return rows.flatMap(({ id, at }) => (at ? [{ id, at }] : []));
  }

  async ideasCaptured({ start, end }: DayRange): Promise<readonly DayRecordMoment[]> {
    return this.database
      .select({ id: ideas.id, at: ideas.capturedAt })
      .from(ideas)
      .where(and(gte(ideas.capturedAt, start), lt(ideas.capturedAt, end)))
      .orderBy(desc(ideas.capturedAt));
  }

  /** Each Task once, at its latest move to the state in the day. */
  private async movedTo(
    state: "done" | "dropped",
    { start, end }: DayRange,
  ): Promise<readonly DayRecordMoment[]> {
    const latest = sql<Date>`max(${taskStateChanges.changedAt})`;
    return this.database
      .select({ id: taskStateChanges.taskId, at: latest.mapWith(taskStateChanges.changedAt) })
      .from(taskStateChanges)
      .where(
        and(
          eq(taskStateChanges.toState, state),
          gte(taskStateChanges.changedAt, start),
          lt(taskStateChanges.changedAt, end),
        ),
      )
      .groupBy(taskStateChanges.taskId)
      .orderBy(desc(latest));
  }
}
