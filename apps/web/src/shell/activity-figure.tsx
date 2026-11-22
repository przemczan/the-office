import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Activity } from "@the-office/contracts";
import type { ReactNode } from "react";
import { activityQueries } from "../api/activity.ts";
import { StripFigure } from "./strip-figure.tsx";

/**
 * After Desks in use: everything The Office is running and the ended items the user hasn't seen,
 * Office-wide, with a live dot while anything runs; it opens the Activity page (spec 2.14).
 */
export function ActivityFigure(): ReactNode {
  const activity = useQuery(activityQueries.list()).data;
  const navigate = useNavigate();
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
          opensPage: true,
          onClick: () => void navigate({ to: "/activity" }),
        }}
      />
      <span className="shell-strip-separator" />
    </>
  );
}

/** "Activity: 3 running, 2 ended not yet seen", the figure in words. */
export function activityFigureName({ items }: Activity): string {
  const ended = items.filter((item) => item.ended).length;
  const running = items.length - ended;
  return `Activity: ${running} running${ended > 0 ? `, ${ended} ended not yet seen` : ""}`;
}
