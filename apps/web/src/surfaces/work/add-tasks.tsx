import { useQuery } from "@tanstack/react-query";
import type { Initiative, TaskSummary } from "@the-office/contracts";
import { Icon, SplitButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ideaQueries } from "../../api/work.ts";
import { NewTaskDialog } from "../../shell/work/new-task-dialog.tsx";
import { canHoldBack } from "../../shell/work/initiative-progress.ts";
import { AddExistingTaskDialog } from "./initiative-membership.tsx";
import { tasksToAdd } from "./initiative-membership-words.ts";

/**
 * "Add a Task" in the Tasks block's head, while the Initiative is open (shaping or active), with
 * "Add an existing Task" (one in no Initiative) in its menu. A new Task is made in the Project of
 * the Idea the Initiative was shaped from, if any, until it has Tasks.
 */
export function AddTasks({
  initiative,
  initiativeTasks,
  tasks,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly TaskSummary[];
  readonly tasks: readonly TaskSummary[];
}): ReactNode {
  const [adding, setAdding] = useState<"new" | "existing">();
  const originIdea = useQuery({
    ...ideaQueries.one(initiative.originIdeaId ?? ""),
    enabled: initiative.originIdeaId !== null,
  });
  if (initiative.state !== "shaping" && initiative.state !== "active") return null;
  return (
    <>
      <SplitButton
        size="sm"
        iconLeft={<Icon name="plus" size={14} />}
        onClick={() => setAdding("new")}
        menuLabel="More ways to add a Task"
        menuAlign="end"
        items={[
          {
            icon: <Icon name="list-plus" size={14} />,
            label: "Add an existing Task",
            onSelect: () => setAdding("existing"),
          },
        ]}
      >
        Add a Task
      </SplitButton>
      {adding === "new" && (
        <NewTaskDialog
          initiative={initiative}
          projectId={originIdea.data?.projectId}
          canWaitFor={initiativeTasks.filter(canHoldBack)}
          onClose={() => setAdding(undefined)}
        />
      )}
      {adding === "existing" && (
        <AddExistingTaskDialog
          initiative={initiative}
          candidates={tasksToAdd(initiative, tasks)}
          onClose={() => setAdding(undefined)}
        />
      )}
    </>
  );
}
