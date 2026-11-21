import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { PRIORITIES } from "../../domain/task.js";

/** The columns of a Task the board's order reads. */
export interface BoardOrderColumns {
  readonly priority: AnyPgColumn;
  readonly order: AnyPgColumn;
  readonly id: AnyPgColumn;
}

/**
 * The board's order (`boardOrder` in domain/manual-order.ts) as Postgres sorts: by priority's rank,
 * then by the order key's code units, then by id. The keys are ASCII, so the "C" collation's byte
 * order is their code-unit order whatever the database's collation; a uuid sorts by its bytes, as
 * its text does. The `tasks_board_order` index is on these very expressions.
 */
export function boardOrderOf(task: BoardOrderColumns): [SQL, SQL, SQL] {
  const ranks = PRIORITIES.map((priority, rank) => sql.raw(`WHEN '${priority}' THEN ${rank}`));
  return [
    sql`(CASE ${task.priority} ${sql.join(ranks, sql` `)} END)`,
    sql`(${task.order} COLLATE "C")`,
    sql`${task.id}`,
  ];
}
