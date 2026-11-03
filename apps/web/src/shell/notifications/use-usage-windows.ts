import { useQuery } from "@tanstack/react-query";
import type { Now } from "@the-office/contracts";
import { engineSettingsQuery } from "../../api/engine.ts";
import { namedUsageWindows, type NamedUsageWindows } from "./now-words.ts";

/**
 * Now's usage windows by engine, named and ordered as Settings › Engines lists the engines; none
 * while the engines are being read, so no window flashes by its id first.
 */
export function useUsageWindows(now: Pick<Now, "usageWindows">): NamedUsageWindows[] {
  const settings = useQuery(engineSettingsQuery());
  if (settings.isPending) return [];
  return namedUsageWindows(now.usageWindows, settings.data?.engines ?? []);
}
