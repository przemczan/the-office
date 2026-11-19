import { Outlet, useMatchRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { WORK_TABS, WorkTabs } from "./work-tabs.tsx";
import "./work.css";

/**
 * Work (prototypes/app/work.js): the Tasks by state on one board for the Projects the Project
 * filter shows, Ideas, Initiatives, and the archived Tasks and Initiatives.
 */
export function WorkPage(): ReactNode {
  const matchRoute = useMatchRoute();
  const shown =
    WORK_TABS.find(({ to }) => to !== "/work" && matchRoute({ to }) !== false) ?? WORK_TABS[0];
  usePageHeading({ title: "Work", crumb: shown.crumb });
  return (
    <div className="work-page">
      <WorkTabs shown={shown.value} />
      <Outlet />
    </div>
  );
}
