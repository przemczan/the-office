import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { WorkSearch, type IdMatches, type SearchMatches } from "../../ports/work-search.js";
import { idStartingWith } from "./id-prefix.js";
import { bestFirst, matching, searchVectorOf, taskSearchVector } from "./search-vector.js";
import { attachments, attachmentTexts, ideas, initiatives, tasks } from "./work.schema.js";
import { initiativeColumns, toAttachment, toIdea, toInitiative, toTask } from "./work-rows.js";

/*
 * An Idea's and an Initiative's searched text is short, so it is parsed as it is searched. A
 * Task's holds its Plan and Definition of Done, so its search reads an index instead
 * (`taskSearchVector`), and a document's text is parsed once as it is stored. A title or name
 * weighs most, so it ranks first. Every match is answered: the search narrows them by the Project
 * filter before it keeps the best.
 */

const taskVector = taskSearchVector(tasks);

const ideaVector = sql`setweight(${searchVectorOf(ideas.title)}, 'A')
  || ${searchVectorOf(ideas.notes)}`;

/** Also what the Archive of Initiatives searches (PostgresInitiativeRepository.archived). */
export const initiativeVector = sql`setweight(${searchVectorOf(initiatives.name)}, 'A')
  || ${searchVectorOf(initiatives.outcome)}`;

const documentVector = sql`setweight(${searchVectorOf(attachments.name)}, 'A')
  || coalesce(${attachmentTexts.searchVector}, ''::tsvector)`;

@Injectable()
export class PostgresWorkSearch extends WorkSearch {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async startingWithId(idPrefix: string): Promise<IdMatches> {
    const [taskRows, ideaRows, initiativeRows] = await Promise.all([
      this.database
        .select()
        .from(tasks)
        .where(idStartingWith(tasks.id, idPrefix))
        .orderBy(asc(tasks.id)),
      this.database
        .select()
        .from(ideas)
        .where(idStartingWith(ideas.id, idPrefix))
        .orderBy(asc(ideas.id)),
      this.database
        .select(initiativeColumns)
        .from(initiatives)
        .where(idStartingWith(initiatives.id, idPrefix))
        .orderBy(asc(initiatives.id)),
    ]);
    return {
      tasks: taskRows.map(toTask),
      ideas: ideaRows.map(toIdea),
      initiatives: initiativeRows.map(toInitiative),
    };
  }

  async matchingInitiativeIds(words: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.database
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(matching(initiativeVector, words));
    return new Set(rows.map(({ id }) => id));
  }

  async matches(words: readonly string[]): Promise<SearchMatches> {
    const [taskRows, ideaRows, initiativeRows, documentRows] = await Promise.all([
      this.database
        .select()
        .from(tasks)
        .where(matching(taskVector, words))
        .orderBy(bestFirst(taskVector, words), asc(tasks.id)),
      this.database
        .select()
        .from(ideas)
        .where(matching(ideaVector, words))
        .orderBy(bestFirst(ideaVector, words), asc(ideas.id)),
      this.database
        .select(initiativeColumns)
        .from(initiatives)
        .where(matching(initiativeVector, words))
        .orderBy(bestFirst(initiativeVector, words), asc(initiatives.id)),
      this.database
        .select({ attachment: attachments })
        .from(attachments)
        .leftJoin(attachmentTexts, eq(attachmentTexts.attachmentId, attachments.id))
        .where(and(eq(attachments.kind, "document"), matching(documentVector, words)))
        .orderBy(bestFirst(documentVector, words), asc(attachments.id)),
    ]);
    return {
      tasks: taskRows.map(toTask),
      ideas: ideaRows.map(toIdea),
      initiatives: initiativeRows.map(toInitiative),
      documents: documentRows.map(({ attachment }) => toAttachment(attachment)),
    };
  }
}
