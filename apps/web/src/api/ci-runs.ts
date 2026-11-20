import { queryOptions } from "@tanstack/react-query";
import {
  ciRunListSchema,
  manualWorkflowListSchema,
  refListSchema,
  RERUN_CI_RUN_ACTION,
  START_WORKFLOW_ACTION,
  type CiRunJobs,
  type CiRunRerun,
  type CiRunWebEvent,
  type WorkflowStart,
} from "@the-office/contracts";
import { callOfficeAction, getFromApi, sendToApiWithNoAnswer } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const CI_RUNS = ["ci-runs"] as const;
// Apart from CI_RUNS, so `ci-runs.changed` doesn't read the workflow files again.
const MANUAL_WORKFLOWS = ["manual-workflows"] as const;

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
  /**
   * Start a workflow: the Project's workflows that can be started by hand on `ref`, as their files
   * there declare them, or why they couldn't be read.
   */
  workflows: (projectId: string, ref: string) =>
    queryOptions({
      queryKey: [...MANUAL_WORKFLOWS, projectId, "at", ref],
      queryFn: ({ signal }) =>
        getFromApi(
          `/projects/${encodeURIComponent(projectId)}/workflows?${new URLSearchParams({ ref })}`,
          manualWorkflowListSchema,
          signal,
        ),
    }),
  /** Start a workflow: the branches and tags of the Project's repository, and its base branch. */
  refs: (projectId: string) =>
    queryOptions({
      queryKey: [...MANUAL_WORKFLOWS, projectId, "refs"],
      queryFn: ({ signal }) =>
        getFromApi(`/projects/${encodeURIComponent(projectId)}/refs`, refListSchema, signal),
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

/**
 * A workflow that can be started by hand starts on a branch or tag, with its inputs as text;
 * refused with why.
 */
export function startWorkflow(
  projectId: string,
  workflow: string,
  ref: string,
  inputs: Readonly<Record<string, string>>,
): Promise<WorkflowStart> {
  return callOfficeAction(START_WORKFLOW_ACTION, {
    projectId,
    workflow,
    ref,
    inputs: { ...inputs },
  });
}

export const ciRunEventInvalidations: Readonly<
  Record<CiRunWebEvent["type"], EventInvalidations[string]>
> = {
  "ci-runs.changed": () => [CI_RUNS],
};
