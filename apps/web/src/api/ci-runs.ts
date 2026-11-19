import { queryOptions } from "@tanstack/react-query";
import {
  ciRunListSchema,
  RERUN_CI_RUN_ACTION,
  type CiRunJobs,
  type CiRunRerun,
  type CiRunWebEvent,
} from "@the-office/contracts";
import { callOfficeAction, getFromApi, sendToApiWithNoAnswer } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const CI_RUNS = ["ci-runs"] as const;

export const ciRunQueries = {
  /**
   * Work › CI: each Project's recent CI runs, newest first, with where each Project's listing
   * stands; every Project's, or only `projectId`'s.
   */
  list: (projectId?: string) =>
    queryOptions({
      queryKey: [...CI_RUNS, projectId ?? "all"],
      queryFn: ({ signal }) =>
        getFromApi(
          projectId === undefined ? "/ci-runs" : `/ci-runs?${new URLSearchParams({ projectId })}`,
          ciRunListSchema,
          signal,
        ),
    }),
};

/**
 * Asks the service to list every Project's CI runs from its code host again. It answers at once;
 * what changed arrives as `ci-runs.changed`.
 */
export function refreshCiRuns(): Promise<void> {
  return sendToApiWithNoAnswer("POST", "/ci-runs/refresh", {});
}

/** A failed or cancelled CI run runs again, with all its jobs or the failed ones; refused with why. */
export function rerunCiRun(projectId: string, runId: number, jobs: CiRunJobs): Promise<CiRunRerun> {
  return callOfficeAction(RERUN_CI_RUN_ACTION, { projectId, runId, jobs });
}

export const ciRunEventInvalidations: Readonly<
  Record<CiRunWebEvent["type"], EventInvalidations[string]>
> = {
  "ci-runs.changed": () => [CI_RUNS],
};
