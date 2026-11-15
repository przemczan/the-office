import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { PersonTask, Project, WorkFilter } from "@the-office/contracts";
import { DataTable, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { rowsOf } from "../../api/pages.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { ShowMore } from "../../shell/show-more.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { WORK_FILTERS } from "./person-tasks.ts";

/**
 * The Tasks the person has a part in, by how they stand (prototypes/app/people.js), in the Projects
 * the filter shows: a page at a time, filtered and counted by the service.
 */
export function WorkTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/work" });
  const projects = useQuery(projectQueries.list());
  const projectFilter = useProjectFilter();
  const [filter, setFilter] = useState<WorkFilter>("all");
  // Another filter keeps the Tasks shown until its own are read, so the tab doesn't blink.
  const tasks = useInfiniteQuery({
    ...taskQueries.ofPerson(roleKey, filter, projectFilter.filter),
    placeholderData: keepPreviousData,
  });
  // The newest page read has the counts as they are now.
  const counted = tasks.data?.pages.at(-1);
  if (!counted) return null;
  return (
    <div className="person-work">
      <div className="person-work-filters" role="group" aria-label="Show">
        {WORK_FILTERS.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            className="person-work-filter"
            aria-pressed={candidate.key === filter}
            onClick={() => setFilter(candidate.key)}
          >
            {candidate.label}{" "}
            <span className="person-work-count">{counted.counts[candidate.key]}</span>
          </button>
        ))}
      </div>
      <InOtherProjectsNote count={counted.elsewhere} one="Task" many="Tasks" />
      <DataTable
        columns={columnsFor(projects.data)}
        rows={rowsOf(tasks.data).map((personTask) => ({ id: personTask.task.id, ...personTask }))}
        empty="No Tasks here. Try another filter."
      />
      <ShowMore list={tasks} />
    </div>
  );
}

function columnsFor(projects: readonly Project[] | undefined): DataTableColumn<PersonTask>[] {
  return [
    {
      key: "task",
      header: "Task",
      wrap: true,
      render: ({ task }) => (
        <div>
          <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="person-work-title">
            {task.title}
          </Link>
          <ProjectChip projectId={task.projectId} projects={projects} />
        </div>
      ),
    },
    { key: "part", header: "Part", render: ({ part }) => part },
    { key: "state", header: "State", render: ({ task }) => <TaskStateBadge state={task.state} /> },
  ];
}
