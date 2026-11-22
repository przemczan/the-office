import type { SidePanelWidths, SidePanelWidthStore } from "@the-office/ui";
import { useSyncExternalStore } from "react";

/** Enough of the page stays in view beside a panel over it to press outside it. */
const PAGE_LEAST_IN_VIEW = 240;

/** How wide a panel over the page is now, and whether its edge resizes it or it fills a narrow window. */
export interface SidePanelLayout {
  /** Its width: the remembered one, as far as the window allows, or the window's when it fills it. */
  readonly width: number;
  /** The widest it can go now. */
  readonly most: number;
  /** Too narrow a window for the least width beside the page: the panel fills it, with no edge. */
  readonly fills: boolean;
}

export function sidePanelLayout(
  windowWidth: number,
  remembered: number,
  { least, most: widest }: SidePanelWidths,
): SidePanelLayout {
  const room = windowWidth - PAGE_LEAST_IN_VIEW;
  if (room < least) return { width: windowWidth, most: windowWidth, fills: true };
  const most = Math.min(widest, room);
  return { width: Math.min(Math.max(remembered, least), most), most, fills: false };
}

/** The layout of a panel over the page (the Needs you panel, Activity), following the window and its edge. */
export function useSidePanelLayout(
  store: SidePanelWidthStore,
  widths: SidePanelWidths,
): SidePanelLayout {
  const windowWidth = useSyncExternalStore(subscribeToWindowWidth, () => window.innerWidth);
  const remembered = useSyncExternalStore(store.subscribe, store.width);
  return sidePanelLayout(windowWidth, remembered, widths);
}

function subscribeToWindowWidth(changed: () => void): () => void {
  window.addEventListener("resize", changed);
  return () => window.removeEventListener("resize", changed);
}
