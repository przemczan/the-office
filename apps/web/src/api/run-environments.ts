import { queryOptions } from "@tanstack/react-query";
import {
  runEnvironmentCpuLimitSchema,
  type CpuLimitChange,
  type RunEnvironmentCpuLimit,
  type RunEnvironmentWebEvent,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const CPU_LIMIT = ["settings", "run-environment-cpu-limit"] as const;

/** Settings › Office limits: the run environments' CPU limit, and what Automatic gives here. */
export const cpuLimitQuery = () =>
  queryOptions({
    queryKey: CPU_LIMIT,
    queryFn: ({ signal }) =>
      getFromApi("/settings/run-environment-cpu-limit", runEnvironmentCpuLimitSchema, signal),
  });

export function changeCpuLimit(change: CpuLimitChange): Promise<RunEnvironmentCpuLimit> {
  return sendToApi(
    "PUT",
    "/settings/run-environment-cpu-limit",
    change,
    runEnvironmentCpuLimitSchema,
  );
}

export const runEnvironmentEventInvalidations: Readonly<
  Record<RunEnvironmentWebEvent["type"], EventInvalidations[string]>
> = {
  "run-environment-cpu-limit.changed": () => [CPU_LIMIT],
};
