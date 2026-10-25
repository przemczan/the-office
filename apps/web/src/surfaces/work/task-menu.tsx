import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Priority, Task } from "@the-office/contracts";
import { Icon, IconButton, Menu, type MenuItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changePriority, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { NOT_STARTED, PRIORITY_ICONS, PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { DropTaskDialog } from "./drop-task-dialog.tsx";

const PRIORITIES: readonly Priority[] = ["high", "normal", "low"];

/** A Task's "More" menu: its priority while it hasn't started, and Drop until it has ended. */
export function TaskMenu({ task }: { readonly task: Task }): ReactNode {
  const [open, setOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const queryClient = useQueryClient();
  const showToast = useToast();
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
  const items: MenuItem[] = [
    ...(NOT_STARTED.includes(task.state)
      ? [
          { heading: "Priority" },
          ...PRIORITIES.map((priority) => ({
            icon: <Icon name={PRIORITY_ICONS[priority]} size={14} />,
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
    ...(task.state === "done" || task.state === "dropped"
      ? []
      : [
          { divider: true },
          {
            icon: <Icon name="x" size={14} />,
            label: "Drop…",
            danger: true,
            onSelect: () => setDropping(true),
          },
        ]),
  ];
  if (items.length === 0) return null;
  return (
    <>
      <Menu
        open={open}
        onOpenChange={setOpen}
        align="end"
        width={200}
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
    </>
  );
}
