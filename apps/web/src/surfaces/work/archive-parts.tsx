import type { Initiative, Task } from "@the-office/contracts";
import { Badge, Icon, type ButtonProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { dayOf } from "../../shell/time.ts";
import { isArchived } from "../../shell/work/work-words.ts";
import { RecordActionButton, type RecordAction } from "./record-actions.tsx";
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
  const restore = useRestoreAction(task);
  return restore && <RecordActionButton action={restore} size={size} />;
}

/** Restore for an Initiative: back on the board in Done or Dropped, as it was. */
export function RestoreInitiativeButton({
  initiative,
  size,
}: {
  readonly initiative: Initiative;
  readonly size?: ButtonProps["size"];
}): ReactNode {
  const restore = useRestoreInitiativeAction(initiative);
  return restore && <RecordActionButton action={restore} size={size} />;
}

/** The Task's Restore while it is archived. */
export function useRestoreAction(task: Task): RecordAction | undefined {
  const restoring = useRestoring();
  if (!isArchived(task)) return undefined;
  return restoreAction(task.title, restoring.isPending, () => restoring.mutate(task));
}

/** The Initiative's Restore while it is archived. */
export function useRestoreInitiativeAction(initiative: Initiative): RecordAction | undefined {
  const restoring = useRestoringInitiative();
  if (!isArchived(initiative)) return undefined;
  return restoreAction(initiative.name, restoring.isPending, () => restoring.mutate(initiative));
}

function restoreAction(name: string, pending: boolean, onRestore: () => void): RecordAction {
  return {
    key: "restore",
    label: "Restore",
    icon: "archive-restore",
    hint: "Return it to the board in the state it had",
    ariaLabel: `Restore ${name}`,
    pending,
    onSelect: onRestore,
  };
}
