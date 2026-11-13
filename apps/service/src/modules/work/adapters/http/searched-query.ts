import { recordLinkOf } from "@the-office/contracts";

/**
 * What a search reads of the user's query: the record's ID when they pasted a link to its page, so
 * the search finds it by ID (spec §2.1); a Decision's link finds its Task. Any other query as typed.
 */
export function searchedQuery(query: string): string {
  const link = recordLinkOf(query.trim());
  switch (link?.kind) {
    case undefined:
      return query;
    case "task":
    case "decision":
      return link.taskId;
    case "initiative":
      return link.initiativeId;
    case "idea":
      return link.ideaId;
  }
}
