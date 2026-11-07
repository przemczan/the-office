import { prioritySchema, type BoardFilters, type Task } from "@the-office/contracts";
import { blockingTasksOf } from "./dependency-words.ts";
import { tagsInUse } from "./tag-words.ts";

/**
 * The board's filters from its address, leaving out whatever isn't one: only the filters set. The
 * search's words are matched by the service (`GET /tasks?query=`), so they mean what ⌘K's do.
 */
export function boardFiltersOf(search: Record<string, unknown>): BoardFilters {
  const { query, priority, tags, initiative, blocked } = search;
  const priorityFound = prioritySchema.safeParse(priority);
  const tagsFound = Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return {
    ...(typeof query === "string" && query.trim() !== "" && { query }),
    ...(priorityFound.success && { priority: priorityFound.data }),
    ...(tagsFound.length > 0 && { tags: tagsFound }),
    ...(typeof initiative === "string" && initiative !== "" && { initiative }),
    ...(blocked === true && { blocked: true as const }),
  };
}

const BOARD_FILTER_KEYS: ReadonlySet<string> = new Set<keyof BoardFilters>([
  "query",
  "priority",
  "tags",
  "initiative",
  "blocked",
]);

/** An address's search without the board's filters, keeping what opens over the page. */
export function withoutBoardFilters(search: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(search).filter(([key]) => !BOARD_FILTER_KEYS.has(key)));
}

export function hasBoardFilters(filters: BoardFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}

/** Whether both narrow the board alike: the same filters set, the Tags in any order. */
export function sameBoardFilters(one: BoardFilters, other: BoardFilters): boolean {
  const tags = new Set(one.tags ?? []);
  return (
    (one.query ?? "").trim() === (other.query ?? "").trim() &&
    one.priority === other.priority &&
    tags.size === new Set(other.tags ?? []).size &&
    (other.tags ?? []).every((tag) => tags.has(tag)) &&
    one.initiative === other.initiative &&
    one.blocked === other.blocked
  );
}

/** The filters with one changed; one emptied is left out, as the address keeps only those set. */
export function withBoardFilter<Key extends keyof BoardFilters>(
  filters: BoardFilters,
  key: Key,
  value: BoardFilters[Key] | undefined,
): BoardFilters {
  return boardFiltersOf({ ...filters, [key]: value });
}

/** The filters with the Tag chosen, or no longer chosen if it was. */
export function withTagToggled(filters: BoardFilters, tag: string): BoardFilters {
  const chosen = filters.tags ?? [];
  const tags = chosen.includes(tag) ? chosen.filter((each) => each !== tag) : [...chosen, tag];
  return withBoardFilter(filters, "tags", tags);
}

/**
 * The Tags to choose from: those in use, and any chosen that no Task has any more, so it can be
 * taken off.
 */
export function tagsOffered(tasks: readonly Task[], filters: BoardFilters): string[] {
  return [...new Set([...tagsInUse(tasks), ...(filters.tags ?? [])])].toSorted();
}

/** A Task in Shaping joins the board as its Initiative is confirmed; until then it has no column. */
export function isOnBoard({ state }: Pick<Task, "state">): boolean {
  return state !== "shaping";
}

/**
 * Whether a Task shows under the filters. `found` holds the Tasks the search matched, once the
 * service has answered; until then the search narrows nothing.
 */
export function boardFilter(
  filters: BoardFilters,
  tasks: readonly Task[],
  found?: ReadonlySet<string>,
): (task: Task) => boolean {
  return (task) =>
    (filters.query === undefined || found === undefined || found.has(task.id)) &&
    (filters.priority === undefined || task.priority === filters.priority) &&
    (filters.tags ?? []).every((tag) => task.tags.includes(tag)) &&
    (filters.initiative === undefined || task.initiativeId === filters.initiative) &&
    (filters.blocked === undefined || blockingTasksOf(task, tasks).length > 0);
}
