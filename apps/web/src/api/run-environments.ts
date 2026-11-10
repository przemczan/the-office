import { queryOptions } from "@tanstack/react-query";
import {
  runEnvironmentOfficeLimitsSchema,
  type RunEnvironmentOfficeLimits,
  type RunEnvironmentOfficeLimitsChange,
  type RunEnvironmentWebEvent,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const OFFICE_LIMITS = ["settings", "run-environments"] as const;

/**
 * Settings › Office limits: the run environments' Office limits, and what Automatic gives here.
 */
export const runEnvironmentOfficeLimitsQuery = () =>
  queryOptions({
    queryKey: OFFICE_LIMITS,
    queryFn: ({ signal }) =>
      getFromApi("/settings/run-environments", runEnvironmentOfficeLimitsSchema, signal),
  });

export function changeRunEnvironmentOfficeLimits(
  change: RunEnvironmentOfficeLimitsChange,
): Promise<RunEnvironmentOfficeLimits> {
  return sendToApi("PUT", "/settings/run-environments", change, runEnvironmentOfficeLimitsSchema);
}

export const runEnvironmentEventInvalidations: Readonly<
  Record<RunEnvironmentWebEvent["type"], EventInvalidations[string]>
> = {
  "run-environment-settings.changed": () => [OFFICE_LIMITS],
};
