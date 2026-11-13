import { useSyncExternalStore } from "react";
import {
  createAppearanceStore,
  type Appearance,
  type AppearanceChosenListener,
  type AppearanceStore,
  type ChosenAppearance,
} from "./appearance-store.ts";

let browserAppearance: AppearanceStore | undefined;

function browserAppearanceStore(): AppearanceStore {
  browserAppearance ??= createAppearanceStore();
  return browserAppearance;
}

/** This browser's appearance, and the ways to change it, which every tab then shows. */
export function useAppearance(): Appearance &
  Pick<AppearanceStore, "choosePalette" | "followSystem" | "chooseDensity"> {
  const store = browserAppearanceStore();
  // The same snapshot when rendered to markup, as tests do with a page's document at hand.
  const appearance = useSyncExternalStore(store.subscribe, store.current, store.current);
  return {
    ...appearance,
    choosePalette: store.choosePalette,
    followSystem: store.followSystem,
    chooseDensity: store.chooseDensity,
  };
}

/**
 * Shows the signed-in user's appearance and keeps it as this browser's cache, unless a choice made
 * on this page is still being saved.
 */
export function adoptAppearance(choice: ChosenAppearance): void {
  browserAppearanceStore().adopt(choice);
}

/** Hears each palette or density chosen on this page, to save it; answers how to stop. */
export function onAppearanceChosen(listener: AppearanceChosenListener): () => void {
  return browserAppearanceStore().onChosen(listener);
}
