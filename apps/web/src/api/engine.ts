import { queryOptions } from "@tanstack/react-query";
import {
  engineAccountSchema,
  engineSettingsSchema,
  engineSignInSchema,
  engineWebEventSchema,
  type EngineSettings,
  type EngineSettingsEdit,
  type EngineSignIn,
  type EngineWebEvent,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi, sendToApiWithNoAnswer } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

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

/** A saved Claude Code engine's account, as `claude auth status` gives it for its folder. */
export const engineAccountQuery = (engineId: string) =>
  queryOptions({
    queryKey: engineAccountKey(engineId),
    queryFn: ({ signal }) =>
      getFromApi(`${enginePath(engineId)}/account`, engineAccountSchema, signal),
  });

/** Starts a Sign in on the engine's folder, giving the sign-in page that gives the code. */
export function startEngineSignIn(engineId: string): Promise<EngineSignIn> {
  return sendToApi("POST", `${enginePath(engineId)}/sign-in`, {}, engineSignInSchema);
}

/** Finishes the Sign in under way with the code its page gave; refused when none is. */
export function enterEngineSignInCode(engineId: string, code: string): Promise<void> {
  return sendToApiWithNoAnswer("POST", `${enginePath(engineId)}/sign-in/code`, { code });
}

/** "Paste a token instead": a `claude setup-token` token signs the engine in, never sent back. */
export function pasteEngineToken(engineId: string, token: string): Promise<void> {
  return sendToApiWithNoAnswer("PUT", `${enginePath(engineId)}/token`, { token });
}

/** Signs the engine out, whatever signed it in. */
export function signOutOfEngine(engineId: string): Promise<void> {
  return deleteFromApi(`${enginePath(engineId)}/sign-in`);
}

/** An engine's account that changed is read again by its id. */
export const engineEventInvalidations: Readonly<
  Record<EngineWebEvent["type"], EventInvalidations[string]>
> = {
  "engine.account-changed": (event) => [
    engineAccountKey(engineWebEventSchema.parse(event).engineId),
  ],
};

function enginePath(engineId: string): `/${string}` {
  return `/settings/engines/${encodeURIComponent(engineId)}`;
}
