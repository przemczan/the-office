import type { TaskSummary } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEveryTask } from "../../api/work.ts";
import { momentWords } from "../../shell/time.ts";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";

/**
 * Why a Dropped Task was dropped, under its head: "Dropped: won't fix", "Dropped: can't
 * reproduce", "Dropped: <Other's words>" or "Dropped as a duplicate of <Task>". A Task dropped with
 * no reason has none: its badge says it all.
 */
export function DropNote({ task }: { readonly task: TaskSummary }): ReactNode {
  const tasks = useEveryTask().data;
  const reason = task.dropReason;
  if (task.state !== "dropped" || reason === null) return null;
  const when = task.endedAt === null ? null : <span> · {momentWords(task.endedAt)}</span>;
  if (reason.kind === "duplicate") {
    const duplicated = tasks?.find(({ id }) => id === reason.taskId);
    return (
      <p className="drop-note" role="note" aria-label="Why it was dropped">
        <Icon name="circle-x" size={14} />
        Dropped as a duplicate of
        {duplicated ? (
          <>
            <Link to="/tasks/$taskId" params={{ taskId: duplicated.id }}>
              {duplicated.title}
            </Link>
            <TaskStateBadge state={duplicated.state} />
          </>
        ) : (
          <span>a Task no longer readable</span>
        )}
        {when}
      </p>
    );
  }
  const words = {
    "wont-fix": "won't fix",
    "cant-reproduce": "can't reproduce",
    other: reason.kind === "other" ? reason.text : "",
  }[reason.kind];
  return (
    <p className="drop-note" role="note" aria-label="Why it was dropped">
      <Icon name="circle-x" size={14} />
      Dropped: {words}
      {when}
    </p>
  );
}
