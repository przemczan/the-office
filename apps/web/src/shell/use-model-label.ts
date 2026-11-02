import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { engineSettingsQuery } from "../api/engine.ts";
import { modelLabel } from "./engine-words.ts";

/** `modelLabel` with the engines Settings › Engines lists now, so their models read by name. */
export function useModelLabel(): (model: string) => string {
  const engines = useQuery(engineSettingsQuery()).data?.engines;
  return useCallback((model: string) => modelLabel(model, engines), [engines]);
}
