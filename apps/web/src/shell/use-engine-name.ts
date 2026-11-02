import { useQuery } from "@tanstack/react-query";
import type { EngineId } from "@the-office/contracts";
import { useCallback } from "react";
import { engineSettingsQuery } from "../api/engine.ts";

/** An engine's name as Settings › Engines lists it now; one no longer listed by its id. */
export function useEngineName(): (engineId: EngineId) => string {
  const engines = useQuery(engineSettingsQuery()).data?.engines;
  return useCallback(
    (engineId: EngineId) => engines?.find(({ id }) => id === engineId)?.name ?? engineId,
    [engines],
  );
}
