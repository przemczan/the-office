import { QueryClient, type QueryKey } from "@tanstack/react-query";
import type { EngineWebEvent } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  engineAccountQuery,
  engineEventCacheUpdates,
  engineEventInvalidations,
  engineSettingsQuery,
} from "./engine.ts";
import { roleCardQueries } from "./people.ts";

/** A cache holding the engines' settings and an engine's account under them. */
function cachedQueries(): { queryClient: QueryClient; keys: Record<string, QueryKey> } {
  const queryClient = new QueryClient();
  const keys: Record<string, QueryKey> = {
    settings: engineSettingsQuery().queryKey,
    account: engineAccountQuery("claude-code").queryKey,
  };
  for (const key of Object.values(keys)) queryClient.setQueryData(key, {});
  return { queryClient, keys };
}

function staleOnes(queryClient: QueryClient, keys: Record<string, QueryKey>): readonly string[] {
  return Object.entries(keys)
    .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
    .map(([name]) => name);
}

describe.each([
  "engine.window-start-changed",
  "engine.account-changed",
  "engine.models-listed",
] as const)("%s", (type) => {
  it("reads the engines' settings again, exactly those, not each engine's account", () => {
    const { queryClient, keys } = cachedQueries();
    const event: EngineWebEvent = {
      type,
      engineId: "claude-code",
      occurredAt: "2026-11-23T06:00:00.000Z",
    };

    engineEventCacheUpdates[type](event, queryClient);

    expect(staleOnes(queryClient, keys)).toEqual(["settings"]);
  });
});

describe("engine.models-listed", () => {
  it("reads the Role card's options again, whose model choices it changes", () => {
    const event: EngineWebEvent = {
      type: "engine.models-listed",
      engineId: "codex",
      occurredAt: "2026-11-23T06:00:00.000Z",
    };

    expect(engineEventInvalidations["engine.models-listed"](event)).toEqual([
      roleCardQueries.options().queryKey,
    ]);
  });
});
