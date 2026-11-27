import {
  QueryClient,
  queryOptions,
  type Query,
  type QueryKey,
  useQueryClient,
} from "@tanstack/react-query";
import {
  daySummarySchema,
  TODAY_KEYWORD,
  type DaySummary,
  type ProjectFilter,
} from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";
import { useOfficeEvent } from "./event-stream-provider.tsx";

const DAYS = ["days"] as const;

function projectParams(projects: ProjectFilter): string {
  const search = new URLSearchParams();
  if (projects !== "all") for (const id of projects) search.append("project", id);
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

export const dayQueries = {
  /**
   * What The Office did on `day`: a `YYYY-MM-DD` day, or `undefined` for the service's today, which
   * the web never works out itself. A past day never goes stale; today's does, and is read again on
   * the events above and when the window is focused.
   */
  one: (day: string | undefined, projects: ProjectFilter) =>
    queryOptions({
      queryKey:
        day === undefined
          ? [...DAYS, TODAY_KEYWORD, { projects }]
          : [...DAYS, "day", day, { projects }],
      queryFn: ({ signal }) =>
        getFromApi(
          `/days/${day ?? TODAY_KEYWORD}${projectParams(projects)}`,
          daySummarySchema,
          signal,
        ),
      // A past day is settled; today's moves on with focus and events.
      staleTime: day === undefined ? 0 : Infinity,
      refetchOnWindowFocus: day === undefined,
    }),
};

/**
 * Whether a cached query is today's: asked for by the keyword, or for the day its own answer calls
 * today.
 */
export function isTodaysQuery(query: Pick<Query, "queryKey" | "state">): boolean {
  const [head, kind, day] = query.queryKey;
  if (head !== DAYS[0]) return false;
  if (kind === TODAY_KEYWORD) return true;
  const data = query.state.data as DaySummary | undefined;
  return kind === "day" && data !== undefined && data.today === day;
}

/** Reads today's queries again, never a past day's. */
export function invalidateToday(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    queryKey: DAYS as QueryKey,
    predicate: isTodaysQuery,
  });
}

/** Keeps today's records current while a part that shows them is mounted. */
export function useDayLiveUpdates(): void {
  const queryClient = useQueryClient();
  const onEvent = (): void => invalidateToday(queryClient);
  useOfficeEvent("task.state-changed", onEvent);
  useOfficeEvent("task.pull-request-end-changed", onEvent);
  useOfficeEvent("initiative.state-changed", onEvent);
  useOfficeEvent("idea.captured", onEvent);
  useOfficeEvent("now.changed", onEvent);
}
