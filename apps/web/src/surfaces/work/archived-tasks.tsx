import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, Task } from "@the-office/contracts";
import { Alert, DataTable, type DataTableColumn } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { dayOf } from "../../shell/time.ts";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { RestoreButton } from "./archive-parts.tsx";
import { archivedTasks } from "./archive-words.ts";

/**
 * Work › Archived: the archived Tasks the Project filter shows, newest archived first, each one
 * click from the board again.
 */
export function ArchivedTasks(): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const projectFilter = useProjectFilter();
  if (tasks.error) return <Alert tone="danger" title={tasks.error.message} />;
  if (!tasks.data) return null;
  const { shown, elsewhere } = narrowed(archivedTasks(tasks.data), (task) =>
    projectFilter.shows([task.projectId]),
  );
  return (
    <div className="archived-tasks">
      <InOtherProjectsNote count={elsewhere} one="archived Task" many="archived Tasks" />
      <DataTable
        columns={columnsFor(projects.data)}
        rows={[...shown]}
        empty="No archived Tasks. Archive a Done or Dropped Task from its More menu."
      />
    </div>
  );
}

function columnsFor(projects: readonly Project[] | undefined): DataTableColumn<Task>[] {
  return [
    {
      key: "task",
      header: "Task",
      wrap: true,
      render: (task) => (
        <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="archived-task-title">
          {task.title}
        </Link>
      ),
    },
    {
      key: "project",
      header: "Project",
      render: (task) => <ProjectChip projectId={task.projectId} projects={projects} />,
    },
    { key: "state", header: "State", render: (task) => <TaskStateBadge state={task.state} /> },
    {
      key: "archivedAt",
      header: "Archived",
      muted: true,
      render: (task) => (task.archivedAt === null ? null : dayOf(task.archivedAt)),
    },
    {
      key: "restore",
      header: "",
      align: "right",
      render: (task) => <RestoreButton task={task} size="sm" />,
    },
  ];
}
