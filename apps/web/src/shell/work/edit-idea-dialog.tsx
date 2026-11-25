import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Idea, IdeaEdit } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { editIdea, ideaQueries } from "../../api/work.ts";
import { useMentions } from "../mentions/mention-picker.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { IdeaFields } from "./idea-fields.tsx";

/** "Edit…" on an Idea not yet shaped: its title, notes and Project. */
export function EditIdeaDialog({
  idea,
  onClose,
}: {
  readonly idea: Idea;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState<IdeaEdit>({
    title: idea.title,
    notes: idea.notes,
    projectId: idea.projectId,
  });
  const mentions = useMentions(draft.notes, (notes) => setDraft({ ...draft, notes }));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const editing = useMutation({
    mutationFn: (edit: IdeaEdit) => editIdea(idea.id, edit),
    onSettled: () => queryClient.invalidateQueries(ideaQueries.list()),
    onSuccess: (edited) => {
      showToast(`Idea saved: ${edited.title}.`);
      onClose();
    },
  });
  return (
    <Dialog
      size="medium"
      title="Edit the Idea"
      unsavedChanges={
        draft.title !== idea.title ||
        draft.notes !== idea.notes ||
        draft.projectId !== idea.projectId
      }
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={editing.isPending}>
          Save
        </Button>
      }
    >
      <form
        id={formId}
        className="dialog-stack"
        onSubmit={(event) => {
          event.preventDefault();
          editing.mutate({ ...draft, notes: mentions.linked(draft.notes) });
        }}
      >
        {editing.error && (
          <RefusalAlert title="The Idea can't be saved yet" error={editing.error} />
        )}
        <IdeaFields draft={draft} onChange={setDraft} mentions={mentions} />
      </form>
    </Dialog>
  );
}
