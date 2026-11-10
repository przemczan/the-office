import type { Initiative, Task } from "@the-office/contracts";
import { Badge, Button, Icon, type ButtonProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { dayOf } from "../../shell/time.ts";
import { isArchived } from "../../shell/work/work-words.ts";
import { useRestoringInitiative } from "./use-initiative-archive.ts";
import { useRestoring } from "./use-task-archive.ts";

/** "Archived 25 Oct" beside the state, on an archived Task or Initiative; nothing on one on the board. */
export function ArchivedBadge({
  record,
}: {
  readonly record: Pick<Task | Initiative, "archivedAt">;
}): ReactNode {
  if (!isArchived(record)) return null;
  return (
    <Badge tone="neutral">
      <Icon name="archive" size={12} />
      Archived {dayOf(record.archivedAt)}
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
    <RestoreButtonOf
      name={task.title}
      size={size}
      pending={restoring.isPending}
      onRestore={() => restoring.mutate(task)}
    />
  );
}

/** Restore for an Initiative: back on the board in Done or Dropped, as it was. */
export function RestoreInitiativeButton({
  initiative,
  size,
}: {
  readonly initiative: Initiative;
  readonly size?: ButtonProps["size"];
}): ReactNode {
  const restoring = useRestoringInitiative();
  if (!isArchived(initiative)) return null;
  return (
    <RestoreButtonOf
      name={initiative.name}
      size={size}
      pending={restoring.isPending}
      onRestore={() => restoring.mutate(initiative)}
    />
  );
}

function RestoreButtonOf({
  name,
  size,
  pending,
  onRestore,
}: {
  readonly name: string;
  readonly size: ButtonProps["size"] | undefined;
  readonly pending: boolean;
  readonly onRestore: () => void;
}): ReactNode {
  return (
    <Button
      variant="secondary"
      {...(size && { size })}
      iconLeft={<Icon name="archive-restore" size={14} />}
      title="Return it to the board in the state it had"
      aria-label={`Restore ${name}`}
      loading={pending}
      onClick={onRestore}
    >
      Restore
    </Button>
  );
}
