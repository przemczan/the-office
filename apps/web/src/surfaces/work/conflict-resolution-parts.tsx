import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Task } from "@the-office/contracts";
import { Fragment, type ReactNode } from "react";
import { taskQueries } from "../../api/work.ts";
import { taskStateWords } from "../../shell/work/work-words.ts";
import {
  CONFLICTS_RESOLVED_BY,
  conflictResolutionsOf,
  isConflictResolutionTask,
  RESOLVES_THE_CONFLICTS_OF,
} from "./conflict-resolution-words.ts";

/** "Fix the merge (In progress)": the Task's link, with its state in words. */
export function TaskWithState({ task }: { readonly task: Task }): ReactNode {
  return (
    <span className="task-with-state">
      <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="task-with-state-title">
        {task.title}
      </Link>{" "}
      <span className="task-with-state-state">({taskStateWords(task.state, task)})</span>
    </span>
  );
}

/**
 * A section of the Description block linking a Task and its Conflict resolution Tasks both ways:
 * on the Task whose pull request had conflicts, each Conflict resolution Task naming it, newest
 * first; on a Conflict resolution Task, the Task it resolves the conflicts of. Nothing otherwise.
 */
export function ConflictResolutionSection({ task }: { readonly task: Task }): ReactNode {
  const tasks = useQuery(taskQueries.list()).data ?? [];
  const resolvedBy = conflictResolutionsOf(task.id, tasks);
  const resolves =
    isConflictResolutionTask(task) && task.resolvesTaskId !== null
      ? tasks.find(({ id }) => id === task.resolvesTaskId)
      : undefined;
  if (resolvedBy.length === 0 && resolves === undefined) return null;
  return (
    <section className="task-record-section" aria-label="Conflict resolution">
      <div className="task-record-section-head">
        <h3 className="task-record-section-title">Conflict resolution</h3>
      </div>
      {resolves && (
        <p className="conflict-resolution-line">
          {RESOLVES_THE_CONFLICTS_OF} <TaskWithState task={resolves} />
        </p>
      )}
      {resolvedBy.length > 0 && (
        <p className="conflict-resolution-line">
          {CONFLICTS_RESOLVED_BY}{" "}
          {resolvedBy.map((each, index) => (
            <Fragment key={each.id}>
              {index > 0 && ", "}
              <TaskWithState task={each} />
            </Fragment>
          ))}
        </p>
      )}
    </section>
  );
}
