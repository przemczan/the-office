import type { Task } from "@the-office/contracts";
import { Badge, Button, Icon, type ButtonProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { dayOf } from "../../shell/time.ts";
import { isArchived } from "../../shell/work/work-words.ts";
import { useRestoring } from "./use-task-archive.ts";

/** "Archived 25 Oct" beside the state, on an archived Task; nothing on one on the board. */
export function ArchivedBadge({ task }: { readonly task: Task }): ReactNode {
  if (!isArchived(task)) return null;
  return (
    <Badge tone="neutral">
      <Icon name="archive" size={12} />
      Archived {dayOf(task.archivedAt)}
    </Badge>
  );
}

/** Restore, one click with no confirmation: the Task is back on the board in the state it had. */
export function RestoreButton({
  task,
  size,
}: {
  readonly task: Task;
  readonly size?: ButtonProps["size"];
}): ReactNode {
  const restoring = useRestoring();
  if (!isArchived(task)) return null;
  return (
    <Button
      variant="secondary"
      {...(size && { size })}
      iconLeft={<Icon name="archive-restore" size={14} />}
      title="Return it to the board in the state it had"
      aria-label={`Restore ${task.title}`}
      loading={restoring.isPending}
      onClick={() => restoring.mutate(task)}
    >
      Restore
    </Button>
  );
}
