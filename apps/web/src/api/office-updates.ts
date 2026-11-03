import { queryOptions } from "@tanstack/react-query";
import {
  API_PATH,
  officeUpdateSchema,
  type OfficeUpdate,
  type OfficeUpdateWebEvent,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi, sendToApiWithNoAnswer } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const OFFICE_UPDATE = ["office-update"] as const;

export const officeUpdateQueries = {
  /** The version The Office runs, what the last check found, and a scheduled update. */
  officeUpdate: () =>
    queryOptions({
      queryKey: OFFICE_UPDATE,
      queryFn: ({ signal }) => getFromApi("/office-update", officeUpdateSchema, signal),
    }),
};

/** Checks the upstream now; answers what it found. */
export function checkForUpdates(): Promise<OfficeUpdate> {
  return sendToApi("POST", "/office-update/check", {}, officeUpdateSchema);
}

/** Schedules the update to the newest commit; refused with the reason. */
export function scheduleOfficeUpdate(): Promise<void> {
  return sendToApiWithNoAnswer("POST", "/office-update/schedule", {});
}

export function cancelOfficeUpdate(): Promise<void> {
  return deleteFromApi("/office-update/schedule");
}

/** Where the launcher's log of the last update opens, as plain text. */
export const OFFICE_UPDATE_LOG_URL = `${API_PATH}/office-update/log`;

export const officeUpdateEventInvalidations: Readonly<
  Record<OfficeUpdateWebEvent["type"], EventInvalidations[string]>
> = {
  "office-update.changed": () => [OFFICE_UPDATE],
};
