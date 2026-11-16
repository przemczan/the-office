import type { NewIdea } from "@the-office/contracts";
import { Dialog, SegmentedControl } from "@the-office/ui";
import { useState, type ReactNode, type SetStateAction } from "react";
import type { PendingAttachment } from "../attachments/pending-attachment.ts";
import { CaptureIdeaActions, CaptureIdeaBody, useCaptureIdea } from "./capture-idea-form.tsx";
import {
  EMPTY_TASK_DRAFT,
  NewTaskActions,
  NewTaskBody,
  useNewTask,
  type NewTaskDraft,
} from "./new-task-dialog.tsx";

/** What Create makes. */
type Creating = "task" | "idea";

const CHOICES = [
  { value: "task", label: "Task" },
  { value: "idea", label: "Idea" },
] as const satisfies readonly { value: Creating; label: string }[];

/**
 * What Create holds whichever is chosen: a Task's fields, its Description being an Idea's notes, and
 * the Project chosen, null for Office-wide, which only an Idea can be, undefined until one is.
 */
type CreateDraft = Omit<NewTaskDraft, "projectId"> & { readonly projectId?: string | null };

function taskDraftOf(draft: CreateDraft): NewTaskDraft {
  return { ...draft, projectId: draft.projectId ?? undefined };
}

/**
 * The top bar's Create: one window, Task or Idea chosen at its top, Task first; below it New Task
 * or Capture an Idea, each starting in `projectId`. Switching keeps the title, the Description or
 * notes, the Project chosen and the Attachments, which both have; the Tags wait for the Task.
 */
export function CreateDialog({
  projectId,
  onClose,
}: {
  /** Where it starts unless the user chooses otherwise; null for none (Office-wide for an Idea). */
  readonly projectId: string | null;
  readonly onClose: () => void;
}): ReactNode {
  const [creating, setCreating] = useState<Creating>("task");
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_TASK_DRAFT);
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
  const task = useNewTask({
    projectId,
    draft: taskDraftOf(draft),
    onChange: (update: SetStateAction<NewTaskDraft>) =>
      setDraft((current) => {
        const next = typeof update === "function" ? update(taskDraftOf(current)) : update;
        // A Task has no Office-wide, so the Idea's choice stays until the Task chooses a Project.
        return { ...next, projectId: next.projectId ?? current.projectId };
      }),
    pending,
    onPendingChange: setPending,
    onClose,
  });
  const ideaProjectId = draft.projectId === undefined ? projectId : draft.projectId;
  const idea = useCaptureIdea({
    draft: { title: draft.title, notes: draft.description, projectId: ideaProjectId },
    onChange: (changed: NewIdea) =>
      setDraft((current) => ({
        ...current,
        title: changed.title,
        description: changed.notes,
        // Only a Project chosen counts, so typing leaves the Task's own starting Project.
        projectId: changed.projectId === ideaProjectId ? current.projectId : changed.projectId,
      })),
    pending,
    onPendingChange: setPending,
    onClose,
  });
  return (
    <Dialog
      size="medium"
      title={creating === "task" ? "New Task" : "Capture an Idea"}
      unsavedChanges={
        draft.title !== "" ||
        draft.description !== "" ||
        draft.projectId !== undefined ||
        (draft.tags?.length ?? 0) > 0 ||
        pending.length > 0
      }
      onClose={onClose}
      actions={
        creating === "task" ? <NewTaskActions form={task} /> : <CaptureIdeaActions form={idea} />
      }
    >
      <div className="dialog-stack">
        <div>
          <SegmentedControl
            options={[...CHOICES]}
            value={creating}
            onChange={(value) => setCreating(value === "idea" ? "idea" : "task")}
          />
        </div>
        {creating === "task" ? <NewTaskBody form={task} /> : <CaptureIdeaBody form={idea} />}
      </div>
    </Dialog>
  );
}
