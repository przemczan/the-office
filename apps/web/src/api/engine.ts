import { queryOptions } from "@tanstack/react-query";
import {
  engineSettingsSchema,
  type EngineSettings,
  type EngineSettingsEdit,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";

const ENGINE_SETTINGS = ["settings", "engines"] as const;

/**
 * Settings › Engines: the engines, an API engine's key only as set or not, the Office default, the
 * Search endpoint and the Model prices.
 */
export const engineSettingsQuery = () =>
  queryOptions({
    queryKey: ENGINE_SETTINGS,
    queryFn: ({ signal }) => getFromApi("/settings/engines", engineSettingsSchema, signal),
  });

/**
 * Saves every engine, in order, the Office default, the Search endpoint and the Model prices;
 * refused with every reason.
 */
export function changeEngineSettings(edit: EngineSettingsEdit): Promise<EngineSettings> {
  return sendToApi("PUT", "/settings/engines", edit, engineSettingsSchema);
}
