import { queryOptions } from "@tanstack/react-query";
import {
  telemetrySettingsSchema,
  type TelemetryChoice,
  type TelemetrySettings,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";

/** Where The Office exports its traces, metrics and logs, from its next start. */
export const TELEMETRY_SETTINGS = ["settings", "telemetry"] as const;

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
