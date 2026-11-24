import { useQuery } from "@tanstack/react-query";
import type { Project, Task } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { CARRIED_RUN_ENVIRONMENT } from "./stage-words.ts";

/**
 * The Task head's line while its Project's Run environment is Not decided yet and the Task's
 * branch carries a valid definition, so its commands run in its own run environment (spec §5.5).
 * Asked of the service only while the Project hasn't decided; nothing for any other Task.
 */
export function CarriedRunEnvironmentNote({
  task,
  projects,
}: {
  readonly task: Pick<Task, "id" | "projectId">;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  const undecided = project?.runEnvironment === "not-decided";
  const carried = useQuery({
    ...projectQueries.taskRunEnvironment(task.projectId, task.id),
    enabled: undecided,
  }).data?.carriesDefinition;
  if (!undecided || carried !== true) return null;
  return (
    <div className="task-head-notes">
      <div className="task-head-note" role="status">
        <Icon name="container" size={14} />
        <span>{CARRIED_RUN_ENVIRONMENT}</span>
      </div>
    </div>
  );
}
