import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { officeUpdateQueries, scheduleOfficeRestart } from "../../../api/office-updates.ts";

/**
 * Restart The Office: schedules a restart, which waits for the work going on as an update does, then
 * reads Settings › Updates again. Settings › Updates' Restart card and the Telemetry card share it.
 */
export function useRestartScheduling(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: scheduleOfficeRestart,
    onSettled: () => queryClient.invalidateQueries(officeUpdateQueries.officeUpdate()),
  });
}
