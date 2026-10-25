import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { Project } from "@the-office/contracts";
import { DataTable, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import {
  inFilter,
  personTasks,
  WORK_FILTERS,
  type PersonTask,
  type WorkFilter,
} from "./person-tasks.ts";

/** The Tasks the person has a part in, by how they stand (prototypes/app/people.js). */
export function WorkTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/work" });
  const tasks = useQuery(taskQueries.list());
  const pipelines = useQuery(pipelineQueries.list());
  const projects = useQuery(projectQueries.list());
  const [filter, setFilter] = useState<WorkFilter>(WORK_FILTERS[0]);
  if (!tasks.data || !pipelines.data) return null;
  const theirs = personTasks(roleKey, tasks.data, pipelines.data);
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
              {theirs.filter((personTask) => inFilter(candidate, personTask)).length}
            </span>
          </button>
        ))}
      </div>
      <DataTable
        columns={columnsFor(projects.data)}
        rows={theirs
          .filter((personTask) => inFilter(filter, personTask))
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
          <div className="person-work-title">{task.title}</div>
          <ProjectChip projectId={task.projectId} projects={projects} />
        </div>
      ),
    },
    { key: "part", header: "Part", render: ({ part }) => part },
    { key: "state", header: "State", render: ({ task }) => <TaskStateBadge state={task.state} /> },
  ];
}
