import { useSyncExternalStore } from "react";
import type { Palette } from "./apply-appearance.ts";
import {
  createAppearanceStore,
  type Appearance,
  type AppearanceStore,
} from "./appearance-store.ts";

let browserAppearance: AppearanceStore | undefined;

/** This browser's appearance, and the way to choose a palette, which every tab then shows. */
export function useAppearance(): Appearance & { choosePalette(palette: Palette): void } {
  browserAppearance ??= createAppearanceStore();
  const appearance = useSyncExternalStore(browserAppearance.subscribe, browserAppearance.current);
  return { ...appearance, choosePalette: browserAppearance.choosePalette };
}
