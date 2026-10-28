import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Initiative } from "@the-office/contracts";
import { initiativeQueries } from "../../api/work.ts";

/** A change to the Initiative from its page: the answer replaces the shown Initiative at once. */
export function useInitiativeChange<Value>(
  initiative: Initiative,
  change: (value: Value) => Promise<Initiative>,
  onChanged?: (changed: Initiative) => void,
): UseMutationResult<Initiative, Error, Value> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (changed) => {
      queryClient.setQueryData(initiativeQueries.one(initiative.id).queryKey, changed);
      onChanged?.(changed);
    },
    onSettled: () => queryClient.invalidateQueries(initiativeQueries.list()),
  });
}
