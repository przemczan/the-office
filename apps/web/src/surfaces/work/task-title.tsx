import type { Task } from "@the-office/contracts";
import { Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeTitle } from "../../api/work.ts";
import { InlineTitleEdit } from "../../shell/inline-title-edit.tsx";
import { useRecordChange } from "./planning-parts.tsx";

/**
 * The Task's title in its header, with a pencil that turns it into a text field in place, in any
 * state but Done and Dropped.
 */
export function TaskTitle({ task }: { readonly task: Task }): ReactNode {
  const [editing, setEditing] = useState(false);
  const changing = useRecordChange(task, (title: string) => changeTitle(task.id, title));
  if (editing) {
    return (
      <InlineTitleEdit
        className="task-title-edit"
        label="Task title"
        initial={task.title}
        saving={changing.isPending}
        error={changing.error}
        onSave={(title) => changing.mutate(title, { onSuccess: () => setEditing(false) })}
        onCancel={() => {
          changing.reset();
          setEditing(false);
        }}
      />
    );
  }
  const ended = task.state === "done" || task.state === "dropped";
  return (
    <>
      <h2>{task.title}</h2>
      {!ended && (
        <IconButton
          icon={<Icon name="pencil" size={14} />}
          label="Edit the title"
          size="sm"
          onClick={() => setEditing(true)}
        />
      )}
    </>
  );
}
