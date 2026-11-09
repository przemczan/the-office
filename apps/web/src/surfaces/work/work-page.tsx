import { useQuery } from "@tanstack/react-query";
import { Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { Tabs } from "@the-office/ui";
import type { ReactNode } from "react";
import { ideaQueries } from "../../api/work.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { projectIdsOfIdea } from "../../shell/work/work-words.ts";
import "./work.css";

const TABS = [
  { value: "tasks", label: "Tasks", to: "/work", crumb: "Tasks by state" },
  { value: "ideas", label: "Ideas", to: "/work/ideas", crumb: "Ideas" },
  { value: "initiatives", label: "Initiatives", to: "/work/initiatives", crumb: "Initiatives" },
  { value: "archived", label: "Archived", to: "/work/archived", crumb: "Archived Tasks" },
] as const;

/**
 * Work (prototypes/app/work.js): the Tasks by state on one board for the Projects the Project
 * filter shows, Ideas, Initiatives, and the archived Tasks.
 */
export function WorkPage(): ReactNode {
  const ideas = useQuery(ideaQueries.list());
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const shown = TABS.find(({ to }) => to !== "/work" && matchRoute({ to }) !== false) ?? TABS[0];
  usePageHeading({ title: "Work", crumb: shown.crumb });
  const projectFilter = useProjectFilter();
  const newIdeas = ideas.data?.filter(
    (idea) => idea.state === "new" && projectFilter.shows(projectIdsOfIdea(idea)),
  ).length;
  return (
    <div className="work-page">
      <div className="work-tabs">
        <Tabs
          tabs={TABS.map(({ value, label }) => ({
            value,
            label,
            ...(value === "ideas" && newIdeas ? { count: newIdeas } : {}),
          }))}
          value={shown.value}
          onChange={(value) => {
            const tab = TABS.find((candidate) => candidate.value === value) ?? TABS[0];
            void navigate({ to: tab.to });
          }}
        />
      </div>
      <Outlet />
    </div>
  );
}
