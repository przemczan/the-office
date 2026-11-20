import { Link } from "@tanstack/react-router";
import type { TaskState } from "@the-office/contracts";
import type { ReactNode } from "react";
import { TASK_STATE_NAMES } from "../../shell/work/work-words.ts";

/** "Being set up in the Task <title> · <state>", with what follows once it is Done. */
export function SetUpTaskLine({
  task,
  children,
}: {
  readonly task: { readonly id: string; readonly title: string; readonly state: TaskState };
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <p className="project-block-note">
      Being set up in the Task{" "}
      <Link to="/tasks/$taskId" params={{ taskId: task.id }}>
        {task.title}
      </Link>{" "}
      · {TASK_STATE_NAMES[task.state]}
      {task.state === "ready" && ", waiting for your Start"}.{children && <> {children}</>}
    </p>
  );
}
