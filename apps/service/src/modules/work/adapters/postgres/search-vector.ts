import { desc, sql, type SQL } from "drizzle-orm";
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

export function matching(vector: SQL, words: readonly string[]): SQL {
  return sql`${vector} @@ ${prefixQuery(words)}`;
}

export function bestFirst(vector: SQL, words: readonly string[]): SQL {
  return desc(sql`ts_rank(${vector}, ${prefixQuery(words)})`);
}

/**
 * Every word as a prefix, all of them required. The words are letters and digits only
 * (`searchWords`), so none is read as the query syntax's operators.
 */
function prefixQuery(words: readonly string[]): SQL {
  const query = words.map((word) => `${word}:*`).join(" & ");
  return sql`to_tsquery('simple', ${query})`;
}
