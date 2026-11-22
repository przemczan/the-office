import {
  queryOptions,
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { actionListSchema, type ActionList, type ActionsEdit } from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";

/**
 * Under the Projects' key, so `project.actions-changed`, which makes every Project stale
 * (projects.ts), reads the Actions again too.
 */
function actionsKey(projectId: string) {
  return ["projects", projectId, "actions"] as const;
}

function actionsPath(projectId: string): `/${string}` {
  return `/projects/${encodeURIComponent(projectId)}/actions`;
}

export const actionQueries = {
  /** The Project's Actions, in the order added, each with who set its values last. */
  list: (projectId: string) =>
    queryOptions({
      queryKey: actionsKey(projectId),
      queryFn: ({ signal }) => getFromApi(actionsPath(projectId), actionListSchema, signal),
    }),
};

/** The Project's Actions, whole and in order: an Action left out is removed. */
export function saveActions(projectId: string, edit: ActionsEdit): Promise<ActionList> {
  return sendToApi("PUT", actionsPath(projectId), edit, actionListSchema);
}

/** Saving the Project's Actions, the list it answers kept as the Project's Actions at once. */
export function useSaveActions(
  projectId: string,
): UseMutationResult<ActionList, Error, ActionsEdit> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (edit: ActionsEdit) => saveActions(projectId, edit),
    onSuccess: (saved) => queryClient.setQueryData(actionsKey(projectId), saved),
  });
}
