import { createSidePanelWidthStore, type SidePanelWidths } from "@the-office/ui";
import { useSidePanelLayout, type SidePanelLayout } from "../side-panel-layout.ts";

/** The panel's width is this browser's choice, never sent to the service. */
export const ACTIVITY_PANEL_WIDTH_STORAGE_KEY = "the-office.activity-panel-width";

export const ACTIVITY_PANEL_WIDTHS: SidePanelWidths = { least: 480, standard: 640, most: 1080 };

const widthStore = createSidePanelWidthStore(
  ACTIVITY_PANEL_WIDTH_STORAGE_KEY,
  ACTIVITY_PANEL_WIDTHS,
);

export const showActivityPanelWidth = widthStore.show;
export const rememberActivityPanelWidth = widthStore.remember;

export function useActivityPanelLayout(): SidePanelLayout {
  return useSidePanelLayout(widthStore, ACTIVITY_PANEL_WIDTHS);
}
