import { and, between, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * The rows whose uuid `id` starts with `idPrefix` (lower-case hex and dashes, `idPrefixOf`). The
 * range of uuids the prefix spans reads the primary key's index, so the condition can sit in an
 * OR beside the search index (`tasks_search`) instead of making the query parse every row; the
 * LIKE keeps out those whose dashes don't fall where the prefix's do.
 */
export function idStartingWith(id: AnyPgColumn, idPrefix: string): SQL | undefined {
  const digits = idPrefix.replaceAll("-", "").slice(0, UUID_DIGITS);
  return and(
    between(id, uuidOf(digits.padEnd(UUID_DIGITS, "0")), uuidOf(digits.padEnd(UUID_DIGITS, "f"))),
    sql`${id}::text LIKE ${`${idPrefix}%`}`,
  );
}

const UUID_DIGITS = 32;

/** 32 hex digits written as a uuid is, 8-4-4-4-12. */
function uuidOf(digits: string): string {
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    digits.slice(12, 16),
    digits.slice(16, 20),
    digits.slice(20),
  ].join("-");
}
