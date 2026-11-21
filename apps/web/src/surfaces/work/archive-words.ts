import {
  archiveStateFilterSchema,
  type ArchiveStateFilter,
  type TaskSummary,
} from "@the-office/contracts";
import { isArchived, type Archived } from "../../shell/work/work-words.ts";

/** The archived Tasks, the newest archived first, as the Archived tab lists them. */
export function archivedTasks(tasks: readonly TaskSummary[]): (TaskSummary & Archived)[] {
  return tasks
    .filter((task) => isArchived(task))
    .toSorted((first, second) => second.archivedAt.localeCompare(first.archivedAt));
}

/**
 * The Archived tab's address: which archive it shows (`?kind=initiatives`, Tasks without), and the
 * Initiatives archive's search, Done / Dropped filter and page, each left out at its default.
 */
export interface ArchivedSearch {
  readonly kind?: "initiatives";
  readonly query?: string;
  readonly state?: Exclude<ArchiveStateFilter, "all">;
  readonly page?: number;
}

export function archivedSearchOf(search: Record<string, unknown>): ArchivedSearch {
  const { kind, query, state, page } = search;
  const stateFound = archiveStateFilterSchema.safeParse(state);
  const pageNumber = typeof page === "string" ? Number(page) : page;
  return {
    ...(kind === "initiatives" && { kind }),
    ...(typeof query === "string" && query.trim() !== "" && { query }),
    ...(stateFound.success && stateFound.data !== "all" && { state: stateFound.data }),
    ...(typeof pageNumber === "number" &&
      Number.isInteger(pageNumber) &&
      pageNumber > 1 && { page: pageNumber }),
  };
}

/**
 * The line a run of archived Initiatives sits under: the month it ended in, "November 2026", or
 * where nothing dates the end.
 */
export function monthLineWords(endedAt: string | null): string {
  if (endedAt === null) return "Ended before its end was kept";
  return MONTH.format(new Date(endedAt));
}

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

/** How many pages `total` archived Initiatives fill, one at least. */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
