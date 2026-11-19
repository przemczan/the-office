import { createSidePanelWidthStore, type SidePanelWidths } from "@the-office/ui";
import { useSyncExternalStore } from "react";

/** The panel's width is this browser's choice, never sent to the service. */
export const NEEDS_YOU_PANEL_WIDTH_STORAGE_KEY = "the-office.needs-you-panel-width";

export const NEEDS_YOU_PANEL_WIDTHS: SidePanelWidths = { least: 480, standard: 640, most: 1080 };

/** Enough of the page stays in view beside the panel to press outside it. */
const PAGE_LEAST_IN_VIEW = 240;

/** How wide the panel is now, and whether its edge resizes it or it fills a narrow window. */
export interface NeedsYouPanelLayout {
  /** Its width: the remembered one, as far as the window allows, or the window's when it fills it. */
  readonly width: number;
  /** The widest it can go now. */
  readonly most: number;
  /** Too narrow a window for the least width beside the page: the panel fills it, with no edge. */
  readonly fills: boolean;
}

const widthStore = createSidePanelWidthStore(
  NEEDS_YOU_PANEL_WIDTH_STORAGE_KEY,
  NEEDS_YOU_PANEL_WIDTHS,
);

export const showNeedsYouPanelWidth = widthStore.show;
export const rememberNeedsYouPanelWidth = widthStore.remember;

export function needsYouPanelLayout(windowWidth: number, remembered: number): NeedsYouPanelLayout {
  const { least, most: widest } = NEEDS_YOU_PANEL_WIDTHS;
  const room = windowWidth - PAGE_LEAST_IN_VIEW;
  if (room < least) return { width: windowWidth, most: windowWidth, fills: true };
  const most = Math.min(widest, room);
  return { width: Math.min(Math.max(remembered, least), most), most, fills: false };
}

export function useNeedsYouPanelLayout(): NeedsYouPanelLayout {
  const windowWidth = useSyncExternalStore(subscribeToWindowWidth, () => window.innerWidth);
  const remembered = useSyncExternalStore(widthStore.subscribe, widthStore.width);
  return needsYouPanelLayout(windowWidth, remembered);
}

function subscribeToWindowWidth(changed: () => void): () => void {
  window.addEventListener("resize", changed);
  return () => window.removeEventListener("resize", changed);
}
