import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * The searchable words of a text, under the `simple` configuration: no language's stemming or stop
 * words, as records mix languages and code. Punctuation is made a space first, so the record splits
 * into words as the query does (`searchWords`): Postgres's parser would keep `notes.md` or a path
 * whole, and "md" would find neither.
 */
export function searchVectorOf(text: AnyPgColumn | SQL): SQL {
  return sql`to_tsvector('simple', regexp_replace(${text}, '[[:punct:][:space:]]+', ' ', 'g'))`;
}
