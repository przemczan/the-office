import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Initiative } from "@the-office/contracts";
import { archiveInitiative, initiativeQueries, restoreInitiative } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";

/** Archive, with no confirmation since Restore undoes it: a toast names the Initiative. */
export function useArchivingInitiative(): UseMutationResult<Initiative, Error, Initiative> {
  return useArchiveChange(archiveInitiative, (initiative) => `${initiative.name} is archived.`);
}

/** Restore, in one click: the Initiative is back on the board in Done or Dropped, as it was. */
export function useRestoringInitiative(): UseMutationResult<Initiative, Error, Initiative> {
  return useArchiveChange(
    restoreInitiative,
    (initiative) => `${initiative.name} is back on the board.`,
  );
}

function useArchiveChange(
  change: (id: string) => Promise<Initiative>,
  words: (changed: Initiative) => string,
): UseMutationResult<Initiative, Error, Initiative> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (initiative: Initiative) => change(initiative.id),
    onSuccess: (changed) => {
      queryClient.setQueryData(initiativeQueries.one(changed.id).queryKey, changed);
      showToast(words(changed));
    },
    onError: (error) => showToast(error.message),
    // ["initiatives"] covers the board, each Initiative's page and the archive's pages.
    onSettled: () => queryClient.invalidateQueries(initiativeQueries.list()),
  });
}
