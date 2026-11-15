import { desc, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { PageCursor } from "../paging/page.js";

/**
 * The rows after the cursor in a list read newest first by `at`, then by `id`: one row comparison,
 * which an index on `(…, at desc, id desc)` reads from where the page starts.
 */
export function afterCursor(
  cursor: PageCursor | undefined,
  at: AnyColumn,
  id: AnyColumn,
): SQL | undefined {
  if (cursor === undefined) return undefined;
  return sql`(${at}, ${id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id})`;
}

/** The order `afterCursor` pages by: the newest first, ties by id. */
export function newestFirst(at: AnyColumn, id: AnyColumn): SQL[] {
  return [desc(at), desc(id)];
}
