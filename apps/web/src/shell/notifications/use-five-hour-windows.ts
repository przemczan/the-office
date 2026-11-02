import { useQuery } from "@tanstack/react-query";
import type { Now } from "@the-office/contracts";
import { engineSettingsQuery } from "../../api/engine.ts";
import { namedFiveHourWindows, type NamedFiveHourWindow } from "./now-words.ts";

/**
 * Now's 5-hour windows by engine, named and ordered as Settings › Engines lists the engines; none
 * while the engines are being read, so no window flashes by its id first.
 */
export function useFiveHourWindows(now: Pick<Now, "fiveHourWindows">): NamedFiveHourWindow[] {
  const settings = useQuery(engineSettingsQuery());
  if (settings.isPending) return [];
  return namedFiveHourWindows(now.fiveHourWindows, settings.data?.engines ?? []);
}
