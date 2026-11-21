import { desc, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { SEARCHED_TEXT_LIMIT } from "../../domain/search.js";

/**
 * The searchable words of a text, under the `simple` configuration: no language's stemming or stop
 * words, as records mix languages and code. Punctuation is made a space first, so the record splits
 * into words as the query does (`searchWords`): Postgres's parser would keep `notes.md` or a path
 * whole, and "md" would find neither.
 */
export function searchVectorOf(text: AnyPgColumn | SQL): SQL {
  return sql`to_tsvector('simple', regexp_replace(${text}, '[[:punct:][:space:]]+', ' ', 'g'))`;
}

/** The columns of a Task its search reads. */
export interface TaskSearchColumns {
  readonly title: AnyPgColumn;
  readonly description: AnyPgColumn;
  readonly plan: AnyPgColumn;
  readonly definitionOfDone: AnyPgColumn;
  readonly tags: AnyPgColumn;
  readonly kind: AnyPgColumn;
}

/**
 * What a Task's search matches: its title weighing most, so it ranks first, then its Description,
 * Plan, Definition of Done, Tags and Kind, so "bug" finds the Bugs. The `tasks_search` index is
 * on this very expression, so a search reads only the matching rows instead of parsing every
 * Task's long texts. `office_words` joins an array's words as `array_to_string` does, declared
 * immutable as an index needs (migration 0184). The index parses each Task as it is saved, so the
 * texts are cut at `SEARCHED_TEXT_LIMIT`, as a document's are: a longer one would refuse the save.
 */
export function taskSearchVector(task: TaskSearchColumns): SQL {
  const texts = sql`${task.description} || ' ' || ${task.plan} || ' '
    || office_words(${task.definitionOfDone}) || ' '
    || office_words(${task.tags}) || ' ' || ${task.kind}`;
  return sql`(setweight(${searchVectorOf(task.title)}, 'A')
  || ${searchVectorOf(sql`left(${texts}, ${sql.raw(String(SEARCHED_TEXT_LIMIT))})`)})`;
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
