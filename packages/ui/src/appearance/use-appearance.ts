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
  // The same snapshot when rendered to markup, as tests do with a page's document at hand.
  const appearance = useSyncExternalStore(
    browserAppearance.subscribe,
    browserAppearance.current,
    browserAppearance.current,
  );
  return {
    ...appearance,
    choosePalette: browserAppearance.choosePalette,
    followSystem: browserAppearance.followSystem,
  };
}
