import { createSidePanelWidthStore, type SidePanelWidths } from "@the-office/ui";
import { useSidePanelLayout, type SidePanelLayout } from "../side-panel-layout.ts";

/** The panel's width is this browser's choice, never sent to the service. */
export const NEEDS_YOU_PANEL_WIDTH_STORAGE_KEY = "the-office.needs-you-panel-width";

export const NEEDS_YOU_PANEL_WIDTHS: SidePanelWidths = { least: 480, standard: 640, most: 1080 };

const widthStore = createSidePanelWidthStore(
  NEEDS_YOU_PANEL_WIDTH_STORAGE_KEY,
  NEEDS_YOU_PANEL_WIDTHS,
);

export const showNeedsYouPanelWidth = widthStore.show;
export const rememberNeedsYouPanelWidth = widthStore.remember;

export function useNeedsYouPanelLayout(): SidePanelLayout {
  return useSidePanelLayout(widthStore, NEEDS_YOU_PANEL_WIDTHS);
}
