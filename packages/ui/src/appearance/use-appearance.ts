import { useSyncExternalStore } from "react";
import {
  createAppearanceStore,
  type Appearance,
  type AppearanceStore,
} from "./appearance-store.ts";

let browserAppearance: AppearanceStore | undefined;

/** This browser's appearance, and the ways to change it, which every tab then shows. */
export function useAppearance(): Appearance &
  Pick<AppearanceStore, "choosePalette" | "followSystem"> {
  browserAppearance ??= createAppearanceStore();
  const appearance = useSyncExternalStore(browserAppearance.subscribe, browserAppearance.current);
  return {
    ...appearance,
    choosePalette: browserAppearance.choosePalette,
    followSystem: browserAppearance.followSystem,
  };
}
