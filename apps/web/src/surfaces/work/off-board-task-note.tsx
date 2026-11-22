import { Link } from "@tanstack/react-router";
import type { Project, Task } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  OFF_BOARD_NOTE_BEFORE,
  OFF_BOARD_TASK_PLACE,
  projectPageWords,
} from "./off-board-task-words.ts";

/**
 * The Task head's line on an Off-board Task: why it isn't on the Work board, and where else it is
 * followed, its Project's page (spec §2.1, "Off-board Tasks").
 */
export function OffBoardTaskNote({
  task,
  projects,
}: {
  readonly task: Pick<Task, "madeFor" | "projectId">;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const { madeFor } = task;
  if (madeFor !== "onboard" && madeFor !== "run-environment-setup") return null;
  const place = OFF_BOARD_TASK_PLACE[madeFor];
  const projectName = projects?.find(({ id }) => id === task.projectId)?.name ?? task.projectId;
  return (
    <div className="task-head-notes">
      <div className="task-head-note">
        <Icon name="info" size={14} />
        <span>
          {OFF_BOARD_NOTE_BEFORE}
          <Link to={place} params={{ projectId: task.projectId }}>
            {projectPageWords(projectName)}
          </Link>
          .
        </span>
      </div>
    </div>
  );
}
