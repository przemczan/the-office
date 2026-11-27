import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  engineAccountSchema,
  engineRemovalPreviewSchema,
  engineSettingsSchema,
  engineSignInSchema,
  engineWebEventSchema,
  type EngineSettings,
  type EngineSettingsEdit,
  type EngineSignIn,
  type EngineWebEvent,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi, sendToApiWithNoAnswer } from "./api-client.ts";
import {
  useOfficeEvent,
  type EventCacheUpdates,
  type EventInvalidations,
} from "./event-stream-provider.tsx";
import { nowQueries } from "./notifications.ts";
import { roleCardQueries } from "./people.ts";
import { usageSettingsQuery } from "./work.ts";

const ENGINE_SETTINGS = ["settings", "engines"] as const;

/** Under the settings' key, so a Save that refreshes the engines reads their accounts again too. */
function engineAccountKey(engineId: string) {
  return [...ENGINE_SETTINGS, engineId, "account"] as const;
}

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

/**
 * What removing the engine with `replacement` taking over would move, and the words it would be
 * refused with; null replaces it with none, which only the only engine takes. Under the settings'
 * key, so a removal or a Save reads it again.
 */
export const engineRemovalQuery = (engineId: string, replacement: string | null) =>
  queryOptions({
    queryKey: [...ENGINE_SETTINGS, engineId, "removal", replacement],
    queryFn: ({ signal }) =>
      getFromApi(
        `${enginePath(engineId)}/removal${replacementQuery(replacement)}`,
        engineRemovalPreviewSchema,
        signal,
      ),
  });

/**
 * Removes the engine, moving everything that names it to `replacement` (none only for the only
 * engine); answers with the settings left.
 */
export function removeEngine(
  engineId: string,
  replacement: string | null,
): Promise<EngineSettings> {
  return sendToApi(
    "POST",
    `${enginePath(engineId)}/removal`,
    replacement === null ? {} : { replacement },
    engineSettingsSchema,
  );
}

/**
 * A saved Claude Code engine's account, as `claude auth status` gives it for its folder, or a saved
 * Codex engine's, as its app-server reads it.
 */
export const engineAccountQuery = (engineId: string) =>
  queryOptions({
    queryKey: engineAccountKey(engineId),
    queryFn: ({ signal }) =>
      getFromApi(`${enginePath(engineId)}/account`, engineAccountSchema, signal),
  });

/**
 * Starts a Sign in on the engine's folder: on a Claude Code engine the sign-in page that gives the
 * code; on a Codex engine the page with the code to enter there, its end announced as
 * `engine.account-changed`.
 */
export function startEngineSignIn(engineId: string): Promise<EngineSignIn> {
  return sendToApi("POST", `${enginePath(engineId)}/sign-in`, {}, engineSignInSchema);
}

/** Finishes the Sign in under way with the code its page gave; refused when none is. */
export function enterEngineSignInCode(engineId: string, code: string): Promise<void> {
  return sendToApiWithNoAnswer("POST", `${enginePath(engineId)}/sign-in/code`, { code });
}

/**
 * "Paste a token instead": a `claude setup-token` token (Claude Code) or a fine-grained personal
 * access token (Copilot CLI) signs the engine in, never sent back.
 */
export function pasteEngineToken(engineId: string, token: string): Promise<void> {
  return sendToApiWithNoAnswer("PUT", `${enginePath(engineId)}/token`, { token });
}

/**
 * An API key signs the engine in, in place of any other sign-in, and is never sent back: "Use an
 * API key" on a Claude Code engine, an Anthropic one (refused unless shaped `sk-ant-<kind>-…`, not `sk-ant-oat…`), kept in
 * the engine's folder; "Use an API key instead" on a Codex engine, an OpenAI one, kept in the
 * database.
 */
export function setEngineApiKey(engineId: string, key: string): Promise<void> {
  return sendToApiWithNoAnswer("PUT", `${enginePath(engineId)}/api-key`, { key });
}

/**
 * Asks the engine's account which models it offers now and keeps them; refused with the engine's
 * words when it fails, and announced as `engine.models-listed` once kept.
 */
export function refreshEngineModels(engineId: string): Promise<void> {
  return sendToApiWithNoAnswer("POST", `${enginePath(engineId)}/models/refresh`, {});
}

/** Signs the engine out, whatever signed it in. */
export function signOutOfEngine(engineId: string): Promise<void> {
  return deleteFromApi(`${enginePath(engineId)}/sign-in`);
}

/** Calls `onChanged` each time the engine's account changes, once it is being read again. */
export function useEngineAccountChanged(engineId: string, onChanged: () => void): void {
  useOfficeEvent("engine.account-changed", (event) => {
    if (engineWebEventSchema.parse(event).engineId === engineId) onChanged();
  });
}

/** The engine events that change the engines' settings exactly, which `engineEventCacheUpdates` applies. */
type ExactEventType = "engine.window-start-changed";

/**
 * An engine's account that changed is read again by its id, and with it what shows its usage
 * windows: an engine an API key signs in has none, so Now's readings and its Window caps in the
 * usage settings come and go with the account. Models an engine listed change what the Role card
 * offers for its type.
 */
export const engineEventInvalidations: Readonly<
  Record<Exclude<EngineWebEvent["type"], ExactEventType>, EventInvalidations[string]>
> = {
  "engine.account-changed": (event) => [
    engineAccountKey(engineWebEventSchema.parse(event).engineId),
    nowQueries.now().queryKey,
    usageSettingsQuery().queryKey,
  ],
  "engine.models-listed": () => [roleCardQueries.options().queryKey],
};

/**
 * An engine's Window start that changed, its account, which gives or takes its usage windows and
 * so its Window start, or the models it listed reads the engines' settings again: exactly those, as ["settings", "engines"]
 * as a prefix would read each engine's account and removal again.
 */
export const engineEventCacheUpdates: Readonly<
  Record<EngineWebEvent["type"], EventCacheUpdates[string]>
> = {
  "engine.account-changed": (_event, queryClient) => invalidateEngineSettings(queryClient),
  "engine.models-listed": (_event, queryClient) => invalidateEngineSettings(queryClient),
  "engine.window-start-changed": (_event, queryClient) => invalidateEngineSettings(queryClient),
};

function invalidateEngineSettings(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: engineSettingsQuery().queryKey, exact: true });
}

function enginePath(engineId: string): `/${string}` {
  return `/settings/engines/${encodeURIComponent(engineId)}`;
}

function replacementQuery(replacement: string | null): string {
  return replacement === null ? "" : `?replacement=${encodeURIComponent(replacement)}`;
}
