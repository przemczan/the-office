import { useQuery } from "@tanstack/react-query";
import type { Activity } from "@the-office/contracts";
import type { ReactNode } from "react";
import { activityQueries } from "../../api/activity.ts";
import { StripFigure } from "../strip-figure.tsx";
import { activityCountWords } from "./activity-words.ts";
import { useActivityPanel } from "./use-activity-panel.ts";

/**
 * After Desks in use: everything The Office is running and the ended items the user hasn't seen,
 * Office-wide, with a live dot while anything runs; it opens the Activity panel (spec 2.14).
 */
export function ActivityFigure(): ReactNode {
  const activity = useQuery(activityQueries.list()).data;
  const panel = useActivityPanel();
  if (!activity) return null;
  const running = activity.items.some(({ ended }) => !ended);
  // Its separator comes with it, so the strip shows none twice before the first read.
  return (
    <>
      <StripFigure
        className="shell-strip-activity"
        label={
          <>
            {running && <span className="live-dot" aria-hidden="true" />}
            Activity
          </>
        }
        value={<b>{activity.count}</b>}
        action={{
          kind: "button",
          name: activityFigureName(activity),
          expanded: panel.isOpen,
          onClick: panel.open,
        }}
      />
      <span className="shell-strip-separator" />
    </>
  );
}

/** "Activity: 3 running, 2 ended not yet seen", the figure in words. */
export function activityFigureName({ items }: Activity): string {
  return `Activity: ${activityCountWords(items)}`;
}
