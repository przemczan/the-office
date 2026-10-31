import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { engineSettingsQuery } from "../api/engine.ts";
import { modelLabel } from "./engine-words.ts";

/** `modelLabel` with the API endpoints Settings › Engines lists now, so their models read by name. */
export function useModelLabel(): (model: string) => string {
  const apiEndpoints = useQuery(engineSettingsQuery()).data?.apiEndpoints;
  return useCallback((model: string) => modelLabel(model, apiEndpoints), [apiEndpoints]);
}
