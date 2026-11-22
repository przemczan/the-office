import { queryOptions } from "@tanstack/react-query";
import {
  branchDeletionPreviewSchema,
  initiativeKnownBranchesSchema,
  taskBranchSchema,
  type BranchDeletionPreview,
  type BranchDeletionRequest,
} from "@the-office/contracts";
import { getFromApi, sendToApiWithNoAnswer } from "./api-client.ts";

/**
 * Whose branch Delete branch… deletes (spec 5.5, "Deleting merged branches"): a Task's own, or an
 * Initiative's in one Project it spans.
 */
export type BranchOwnerRef =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string; readonly projectId: string };

export const branchQueries = {
  /** The Task's own branch and whether it is known here; under the Task's key, so its events refresh it. */
  ofTask: (taskId: string) =>
    queryOptions({
      queryKey: ["tasks", taskId, "branch"],
      queryFn: ({ signal }) =>
        getFromApi(`/tasks/${encodeURIComponent(taskId)}/branch`, taskBranchSchema, signal),
    }),
  /** The Initiative's branches and whether each is known here; under the Initiative's key. */
  ofInitiative: (initiativeId: string) =>
    queryOptions({
      queryKey: ["initiatives", initiativeId, "branches"],
      queryFn: ({ signal }) =>
        getFromApi(
          `/initiatives/${encodeURIComponent(initiativeId)}/branches`,
          initiativeKnownBranchesSchema,
          signal,
        ),
    }),
  /**
   * What deleting the branch would delete, judged as the window opens; kept apart from the
   * owner's key so its events don't judge it again (each judgement fetches) while it is open.
   */
  deletion: (owner: BranchOwnerRef) =>
    queryOptions({
      queryKey: ["branch-deletion", owner],
      queryFn: ({ signal }): Promise<BranchDeletionPreview> =>
        getFromApi(branchDeletionPath(owner), branchDeletionPreviewSchema, signal),
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
};

/** Deletes the branch as judged; refused with the reason when it moved or can't go. */
export function deleteBranch(owner: BranchOwnerRef, request: BranchDeletionRequest): Promise<void> {
  return sendToApiWithNoAnswer("POST", branchDeletionPath(owner), request);
}

function branchDeletionPath(owner: BranchOwnerRef): `/${string}` {
  return owner.kind === "task"
    ? `/tasks/${encodeURIComponent(owner.taskId)}/branch-deletion`
    : `/initiatives/${encodeURIComponent(owner.initiativeId)}/projects/${encodeURIComponent(owner.projectId)}/branch-deletion`;
}
