import { queryOptions } from "@tanstack/react-query";
import {
  basicStatsSchema,
  fullStatsSchema,
  telemetrySettingsSchema,
  type FullStatsRange,
  type FullStatsSplit,
  type ProjectFilter,
  type TelemetryChoice,
  type TelemetrySettings,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";

/** Where The Office exports its traces, metrics and logs, from its next start. */
export const TELEMETRY_SETTINGS = ["settings", "telemetry"] as const;

/** The basic stats, read again every minute while Stats is open (spec 2.11). */
export const BASIC_STATS = ["stats", "basic"] as const;

/** How often Stats reads the basic stats again while it is open. */
export const BASIC_STATS_REFRESH_MS = 60_000;

/** The full stats, read again every minute while Stats is open (spec 2.11). */
export const FULL_STATS = ["stats", "full"] as const;

/** How often Stats reads the full stats again while Grafana starts: every few seconds. */
export const FULL_STATS_STARTING_REFRESH_MS = 3_000;

export const statsQueries = {
  /**
   * The full stats for the range and split, tokens and cost over time and the most expensive
   * narrowed to the Projects the Project filter shows; read every few seconds while Grafana starts.
   */
  full: (filter: ProjectFilter, range: FullStatsRange, split: FullStatsSplit) =>
    queryOptions({
      queryKey: [...FULL_STATS, filter, range, split],
      queryFn: ({ signal }) => {
        const projects =
          filter === "all" ? [] : filter.map((id): [string, string] => ["project", id]);
        const params = new URLSearchParams([["range", range], ["split", split], ...projects]);
        return getFromApi(`/stats/full?${params.toString()}`, fullStatsSchema, signal);
      },
      refetchInterval: (query) =>
        query.state.data?.state === "starting"
          ? FULL_STATS_STARTING_REFRESH_MS
          : BASIC_STATS_REFRESH_MS,
    }),
  /**
   * The basic stats, the top Tasks, Tasks done and Stage retries narrowed to the Projects the
   * Project filter shows, each named as a `project`; tokens per day and the windows Office-wide.
   */
  basic: (filter: ProjectFilter) =>
    queryOptions({
      queryKey: [...BASIC_STATS, filter],
      queryFn: ({ signal }) => {
        const projects =
          filter === "all" ? [] : filter.map((id): [string, string] => ["project", id]);
        const params = new URLSearchParams(projects).toString();
        return getFromApi(
          params === "" ? "/stats/basic" : `/stats/basic?${params}`,
          basicStatsSchema,
          signal,
        );
      },
      refetchInterval: BASIC_STATS_REFRESH_MS,
    }),
};

export const telemetryQueries = {
  /** The saved choice, its headers by name alone, beside what runs now. */
  settings: () =>
    queryOptions({
      queryKey: TELEMETRY_SETTINGS,
      queryFn: ({ signal }) => getFromApi("/settings/telemetry", telemetrySettingsSchema, signal),
    }),
};

/**
 * Saves the choice for the next start; `headers` left out keeps the saved ones, and a header sent
 * with an empty value keeps its saved value.
 */
export function saveTelemetry(choice: TelemetryChoice): Promise<TelemetrySettings> {
  return sendToApi("PUT", "/settings/telemetry", choice, telemetrySettingsSchema);
}

/**
 * Try again: starts the bundled Grafana once more after it couldn't start, answering the settings
 * with its state. Refused while Bundled Grafana isn't saved or the environment sets telemetry.
 */
export function startBundledGrafana(): Promise<TelemetrySettings> {
  return sendToApi(
    "POST",
    "/settings/telemetry/bundled-grafana/start",
    {},
    telemetrySettingsSchema,
  );
}
