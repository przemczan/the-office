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
import { dropReasonWords } from "../../shell/work/drop-reason-field.tsx";
import { KindMark, TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import type { Archived } from "../../shell/work/work-words.ts";
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
        columns={columnsFor(projects.data, tasks.data)}
        rows={[...shown]}
        empty="No archived Tasks. Archive a Done or Dropped Task from its More menu."
      />
    </div>
  );
}

function columnsFor(
  projects: readonly Project[] | undefined,
  tasks: readonly Task[],
): DataTableColumn<Task & Archived>[] {
  return [
    {
      key: "task",
      header: "Task",
      wrap: true,
      render: (task) => (
        <span className="archived-task">
          <KindMark kind={task.kind} />
          <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="archived-task-title">
            {task.title}
          </Link>
        </span>
      ),
    },
    {
      key: "project",
      header: "Project",
      render: (task) => <ProjectChip projectId={task.projectId} projects={projects} />,
    },
    {
      key: "state",
      header: "State",
      // The Drop reason sits under the badge, so no column stays empty for Done Tasks.
      render: (task) => (
        <span className="archived-task-state">
          <TaskStateBadge state={task.state} />
          {task.state === "dropped" && task.dropReason !== null && (
            <span className="archived-drop-reason">
              {dropReasonWords(
                task.dropReason,
                tasks.find(
                  ({ id }) =>
                    task.dropReason?.kind === "duplicate" && id === task.dropReason.taskId,
                ),
              )}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "archivedAt",
      header: "Archived",
      muted: true,
      render: (task) => dayOf(task.archivedAt),
    },
    {
      key: "restore",
      header: "",
      align: "right",
      render: (task) => <RestoreButton task={task} size="sm" />,
    },
  ];
}
