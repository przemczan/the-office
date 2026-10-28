import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { Project } from "@the-office/contracts";
import { DataTable, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import {
  inFilter,
  personTasks,
  WORK_FILTERS,
  type PersonTask,
  type WorkFilter,
} from "./person-tasks.ts";

/**
 * The Tasks the person has a part in, by how they stand (prototypes/app/people.js), in the Projects
 * the filter shows.
 */
export function WorkTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/work" });
  const tasks = useQuery(taskQueries.list());
  const pipelines = useQuery(pipelineQueries.list());
  const projects = useQuery(projectQueries.list());
  const threads = useQuery(threadQueries.onTasksWith(roleKey));
  const openDecisions = useQuery(decisionQueries.open());
  const projectFilter = useProjectFilter();
  const [filter, setFilter] = useState<WorkFilter>(WORK_FILTERS[0]);
  if (!tasks.data || !pipelines.data || !threads.data || !openDecisions.data) return null;
  const { shown: theirs, elsewhere } = narrowed(
    personTasks(roleKey, tasks.data, pipelines.data, threads.data),
    ({ task }) => projectFilter.shows([task.projectId]),
  );
  return (
    <div className="person-work">
      <div className="person-work-filters" role="group" aria-label="Show">
        {WORK_FILTERS.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            className="person-work-filter"
            aria-pressed={candidate.key === filter.key}
            onClick={() => setFilter(candidate)}
          >
            {candidate.label}{" "}
            <span className="person-work-count">
              {
                theirs.filter((personTask) => inFilter(candidate, personTask, openDecisions.data))
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      <InOtherProjectsNote count={elsewhere} one="Task" many="Tasks" />
      <DataTable
        columns={columnsFor(projects.data)}
        rows={theirs
          .filter((personTask) => inFilter(filter, personTask, openDecisions.data))
          .map((personTask) => ({ id: personTask.task.id, ...personTask }))}
        empty="No Tasks here. Try another filter."
      />
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
