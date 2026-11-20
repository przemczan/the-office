import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Tabs } from "@the-office/ui";
import type { ReactNode } from "react";
import { pullRequestQueries } from "../../api/pull-requests.ts";
import { ideaQueries, initiativeQueries, taskQueries } from "../../api/work.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import {
  newIdeasCount,
  openPullRequestsCount,
  openTasksCount,
  shapingInitiativesCount,
} from "./work-tab-counts.ts";
import "./work.css";

/** Work's tabs, each with the list it goes to and the crumb Work shows for it. */
export const WORK_TABS = [
  { value: "tasks", label: "Tasks", to: "/work", crumb: "Tasks by state" },
  { value: "ideas", label: "Ideas", to: "/work/ideas", crumb: "Ideas" },
  { value: "initiatives", label: "Initiatives", to: "/work/initiatives", crumb: "Initiatives" },
  {
    value: "pull-requests",
    label: "Pull requests",
    to: "/work/pull-requests",
    crumb: "Pull requests",
  },
  { value: "ci", label: "CI", to: "/work/ci", crumb: "CI runs" },
  { value: "archived", label: "Archived", to: "/work/archived", crumb: "Archived" },
] as const;

export type WorkTab = (typeof WORK_TABS)[number]["value"];

/**
 * Work's tab strip with its counts, on Work and at the top of the Task page (Tasks) and the
 * Initiative page (Initiatives), whose routes sit beside `/work`. Pressing a tab goes to its list.
 * It reads the same lists as the boards, so their events keep the counts current.
 */
export function WorkTabs({ shown }: { readonly shown: WorkTab }): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const ideas = useQuery(ideaQueries.list());
  const initiatives = useQuery(initiativeQueries.list());
  const pullRequests = useQuery(pullRequestQueries.list());
  const navigate = useNavigate();
  const { shows } = useProjectFilter();
  const counts: Partial<Record<WorkTab, number>> = {
    tasks: openTasksCount(tasks.data ?? [], shows),
    ideas: newIdeasCount(ideas.data ?? [], shows),
    initiatives: shapingInitiativesCount(initiatives.data ?? [], shows),
    "pull-requests": openPullRequestsCount(pullRequests.data?.pullRequests ?? [], shows),
  };
  return (
    <div className="work-tabs">
      <Tabs
        tabs={WORK_TABS.map(({ value, label }) => {
          const count = counts[value];
          return { value, label, ...(count ? { count } : {}) };
        })}
        value={shown}
        onChange={(value) => {
          const tab = WORK_TABS.find((candidate) => candidate.value === value) ?? WORK_TABS[0];
          void navigate({ to: tab.to });
        }}
      />
    </div>
  );
}
