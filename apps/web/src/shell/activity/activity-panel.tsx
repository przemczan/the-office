import { useQuery } from "@tanstack/react-query";
import { Drawer, SidePanelEdge } from "@the-office/ui";
import type { ReactNode } from "react";
import { activityQueries } from "../../api/activity.ts";
import { ActivityFeed } from "./activity-feed.tsx";
import {
  ACTIVITY_PANEL_WIDTHS,
  rememberActivityPanelWidth,
  showActivityPanelWidth,
  useActivityPanelLayout,
} from "./activity-panel-width.ts";
import { activityCountWords } from "./activity-words.ts";
import { useActivityPanel } from "./use-activity-panel.ts";

/**
 * Everything The Office is running over any page, opened from the status strip's Activity figure
 * (spec 2.14). Its description counts Office-wide, as the figure does. Its left edge resizes it, as
 * the Needs you panel's does.
 */
export function ActivityPanel(): ReactNode {
  const panel = useActivityPanel();
  const activity = useQuery(activityQueries.list()).data;
  const layout = useActivityPanelLayout();
  if (!panel.isOpen) return null;
  return (
    <Drawer
      title="Activity"
      description={activity && activityCountWords(activity.count)}
      width={layout.width}
      // The edge is placed against the panel, outside its scrolling content.
      style={{ position: "relative" }}
      onClose={panel.close}
    >
      {!layout.fills && (
        <SidePanelEdge
          label="Resize the Activity panel"
          width={layout.width}
          least={ACTIVITY_PANEL_WIDTHS.least}
          most={layout.most}
          standard={ACTIVITY_PANEL_WIDTHS.standard}
          onResize={showActivityPanelWidth}
          onResized={rememberActivityPanelWidth}
        />
      )}
      <ActivityFeed />
    </Drawer>
  );
}
