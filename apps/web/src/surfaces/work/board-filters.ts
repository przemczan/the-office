import {
  isOffBoardTask,
  prioritySchema,
  taskKindSchema,
  type BoardFilters,
  type TaskSummary,
} from "@the-office/contracts";
import { isArchived } from "../../shell/work/work-words.ts";
import { blockingTasksOf } from "../../shell/work/initiative-progress.ts";

/**
 * The board's filters from its address, leaving out whatever isn't one: only the filters set. The
 * search's words are matched by the service (`GET /tasks?query=`), so they mean what ⌘K's do.
 */
export function boardFiltersOf(search: Record<string, unknown>): BoardFilters {
  const { query, priority, kind, initiative, blocked } = search;
  const priorityFound = prioritySchema.safeParse(priority);
  const kindFound = taskKindSchema.safeParse(kind);
  return {
    ...(typeof query === "string" && query.trim() !== "" && { query }),
    ...(priorityFound.success && { priority: priorityFound.data }),
    ...(kindFound.success && { kind: kindFound.data }),
    ...(typeof initiative === "string" && initiative !== "" && { initiative }),
    ...(blocked === true && { blocked: true as const }),
  };
}

const BOARD_FILTER_KEYS: ReadonlySet<string> = new Set<keyof BoardFilters>([
  "query",
  "priority",
  "kind",
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

/** Whether both narrow the board alike: the same filters set. */
export function sameBoardFilters(one: BoardFilters, other: BoardFilters): boolean {
  return (
    (one.query ?? "").trim() === (other.query ?? "").trim() &&
    one.priority === other.priority &&
    one.kind === other.kind &&
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

/**
 * A Task in Shaping joins the board as its Initiative is confirmed; until then it has no column. An
 * archived Task has left it, until restored. An Off-board Task (Onboard, Set up the run
 * environment) is never on it: The Office starts it at once and the Project page follows it.
 */
export function isOnBoard(task: Pick<TaskSummary, "state" | "archivedAt" | "madeFor">): boolean {
  return task.state !== "shaping" && !isArchived(task) && !isOffBoardTask(task);
}

/**
 * Whether a Task shows under the filters. `found` holds the Tasks the search matched, once the
 * service has answered; until then the search narrows nothing.
 */
export function boardFilter(
  filters: BoardFilters,
  tasks: readonly TaskSummary[],
  found?: ReadonlySet<string>,
): (task: TaskSummary) => boolean {
  return (task) =>
    (filters.query === undefined || found === undefined || found.has(task.id)) &&
    (filters.priority === undefined || task.priority === filters.priority) &&
    (filters.kind === undefined || task.kind === filters.kind) &&
    (filters.initiative === undefined || task.initiativeId === filters.initiative) &&
    (filters.blocked === undefined || blockingTasksOf(task, tasks).length > 0);
}
