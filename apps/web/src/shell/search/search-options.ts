import type { Role, SearchResults } from "@the-office/contracts";
import { personName } from "../person-name.ts";

/** A search reads at most this many words, as the service does. */
const MAX_SEARCH_WORDS = 12;

/**
 * The words a search matches, each as the start of a word: letters and digits only, lower-cased,
 * each once. It mirrors the service's `searchWords`, so people are matched as records are.
 */
export function searchWords(query: string): string[] {
  return [...new Set(wordsOf(query))].slice(0, MAX_SEARCH_WORDS);
}

/** The people hired whose name or title has a word starting with each of the words. */
export function peopleMatching(roles: readonly Role[], words: readonly string[]): Role[] {
  if (words.length === 0) return [];
  return roles.filter(({ card, letGoAt }) => {
    if (letGoAt !== null) return false;
    const own = wordsOf(`${card.name} ${card.title}`);
    return words.every((word) => own.some((ownWord) => ownWord.startsWith(word)));
  });
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** What picking a search's option opens. */
export type SearchPick =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "idea"; readonly ideaId: string }
  | { readonly kind: "person"; readonly roleKey: string }
  | { readonly kind: "document"; readonly id: string; readonly name: string };

export interface SearchOption {
  readonly key: string;
  readonly label: string;
  /** None for a record Office-wide, and for a person. */
  readonly projectIds: readonly string[];
  /** Said beside the label: "Archived" for a Task off the board. */
  readonly mark?: string;
  readonly pick: SearchPick;
}

export interface SearchGroup {
  readonly kind: SearchPick["kind"];
  readonly heading: string;
  readonly options: readonly SearchOption[];
}

/**
 * What the search found, in the spec's order (§2.1): Tasks, Initiatives, Ideas, people, then
 * documents; a kind with nothing found is left out.
 */
export function searchGroups(
  results: SearchResults | undefined,
  people: readonly Role[],
): SearchGroup[] {
  const groups: SearchGroup[] = [
    {
      kind: "task",
      heading: "Tasks",
      options: (results?.tasks ?? []).map(({ id, title, projectIds, archived }) => ({
        key: `task-${id}`,
        label: title,
        projectIds,
        ...(archived && { mark: "Archived" }),
        pick: { kind: "task", taskId: id },
      })),
    },
    {
      kind: "initiative",
      heading: "Initiatives",
      options: (results?.initiatives ?? []).map(({ id, name, projectIds }) => ({
        key: `initiative-${id}`,
        label: name,
        projectIds,
        pick: { kind: "initiative", initiativeId: id },
      })),
    },
    {
      kind: "idea",
      heading: "Ideas",
      options: (results?.ideas ?? []).map(({ id, title, projectIds }) => ({
        key: `idea-${id}`,
        label: title,
        projectIds,
        pick: { kind: "idea", ideaId: id },
      })),
    },
    {
      kind: "person",
      heading: "People",
      options: people.map((role) => ({
        key: `person-${role.key}`,
        label: personName(role),
        projectIds: [],
        pick: { kind: "person", roleKey: role.key },
      })),
    },
    {
      kind: "document",
      heading: "Documents",
      options: (results?.attachments ?? []).map(({ id, name, projectIds }) => ({
        key: `document-${id}`,
        label: name,
        projectIds,
        pick: { kind: "document", id, name },
      })),
    },
  ];
  return groups.filter(({ options }) => options.length > 0);
}

/** How many more matches, of every kind, the Project filter leaves out. */
export function matchesInOtherProjects(results: SearchResults | undefined): number {
  if (!results) return 0;
  const { tasks, ideas, initiatives, attachments } = results.inOtherProjects;
  return tasks + ideas + initiatives + attachments;
}
