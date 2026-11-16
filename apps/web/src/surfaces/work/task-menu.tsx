import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Priority, Task } from "@the-office/contracts";
import { Icon, IconButton, type MenuItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changePriority, taskQueries } from "../../api/work.ts";
import { FloatingMenu } from "../../shell/floating-menu.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { PriorityGlyph } from "../../shell/work/task-state-badge.tsx";
import { canBeArchived, NOT_STARTED, PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { DropTaskDialog } from "../../shell/work/drop-task-dialog.tsx";
import { EditTaskStagesDialog } from "./edit-task-stages-dialog.tsx";
import { MoveTaskDialog } from "./move-task-dialog.tsx";
import { usePlanningActions } from "./planning-actions.tsx";
import { withActionItems, type RecordAction } from "./record-actions.tsx";
import { useArchiving } from "./use-task-archive.ts";

const PRIORITIES: readonly Priority[] = ["high", "normal", "low"];

/**
 * A Task's "More" menu: first its actions, every button of its page's head (`useTaskActions`), or
 * on its board card what moves it along in planning; then its priority while it hasn't started,
 * its Stages to edit, Move and Drop until it has ended, and Archive once it has. Move shows even
 * where it is refused, as its window says why.
 */
export function TaskMenu({
  task,
  actions,
}: {
  readonly task: Task;
  readonly actions?: readonly RecordAction[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [editingStages, setEditingStages] = useState(false);
  const [moving, setMoving] = useState(false);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const planningActions = usePlanningActions(task);
  const archiving = useArchiving();
  const prioritising = useMutation({
    mutationFn: (priority: Priority) => changePriority(task.id, priority),
    onSuccess: (changed) => {
      showToast(
        `${changed.title} is now ${PRIORITY_NAMES[changed.priority].toLowerCase()} priority.`,
      );
    },
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
  const ownItems: MenuItem[] = [
    ...(NOT_STARTED.includes(task.state)
      ? [
          { heading: "Priority" },
          ...PRIORITIES.map((priority) => ({
            icon: <PriorityGlyph priority={priority} size={14} />,
            label: (
              <span className="menu-choice">
                {PRIORITY_NAMES[priority]}
                {priority === task.priority && <Icon name="check" size={14} />}
              </span>
            ),
            onSelect: () => prioritising.mutate(priority),
          })),
        ]
      : []),
    ...(canBeArchived(task)
      ? [
          {
            icon: <Icon name="archive" size={14} />,
            label: "Archive",
            onSelect: () => archiving.mutate(task),
          },
        ]
      : []),
    ...(task.state === "done" || task.state === "dropped"
      ? []
      : [
          ...(task.state === "shaping"
            ? []
            : [
                {
                  icon: <Icon name="route" size={14} />,
                  label: "Edit Stages for this Task",
                  onSelect: () => setEditingStages(true),
                },
              ]),
          {
            icon: <Icon name="folder-input" size={14} />,
            label: "Move to another Project…",
            onSelect: () => setMoving(true),
          },
          { divider: true },
          {
            icon: <Icon name="x" size={14} />,
            label: "Drop…",
            danger: true,
            onSelect: () => setDropping(true),
          },
        ]),
  ];
  const items = withActionItems(actions ?? planningActions, ownItems);
  if (items.length === 0) return null;
  return (
    <>
      <FloatingMenu
        open={open}
        onOpenChange={setOpen}
        align="end"
        width={220}
        trigger={
          <IconButton
            size="xs"
            icon={<Icon name="ellipsis" size={14} />}
            label={`More for ${task.title}`}
          />
        }
        items={items}
      />
      {dropping && <DropTaskDialog task={task} onClose={() => setDropping(false)} />}
      {moving && <MoveTaskDialog task={task} onClose={() => setMoving(false)} />}
      {editingStages && (
        <EditTaskStagesDialog task={task} onClose={() => setEditingStages(false)} />
      )}
    </>
  );
}
