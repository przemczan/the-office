import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Idea, NewIdea } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { captureIdea, ideaQueries } from "../../api/work.ts";
import { attachAll, type PendingAttachment } from "../attachments/pending-attachment.ts";
import { PendingAttachmentsField } from "../attachments/pending-attachments-field.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { IdeaFields } from "./idea-fields.tsx";

/**
 * "Idea" in the top bar: a title, optional notes and Attachments, in a Project or Office-wide.
 * Enter in the title captures it.
 */
export function CaptureIdeaDialog({
  projectId,
  onClose,
}: {
  /** Where the Idea is captured unless the user chooses otherwise; null for Office-wide. */
  readonly projectId: string | null;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState<NewIdea>({ title: "", notes: "", projectId });
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
  const queryClient = useQueryClient();
  const showToast = useToast();
  // Once captured, a failed Attachment is tried again without capturing the Idea twice.
  const [captured, setCaptured] = useState<Idea>();
  const capturing = useMutation({
    mutationFn: async (newIdea: NewIdea) => {
      const idea = captured ?? (await captureIdea(newIdea));
      setCaptured(idea);
      await attachAll({ kind: "idea", ideaId: idea.id }, pending, () =>
        setPending((left) => left.slice(1)),
      );
      return idea;
    },
    onSettled: () => queryClient.invalidateQueries(ideaQueries.list()),
    onSuccess: (idea) => {
      showToast(`Idea captured: ${idea.title}.`);
      onClose();
    },
  });
  return (
    <Dialog
      size="medium"
      title="Capture an Idea"
      unsavedChanges={
        draft.title !== "" ||
        draft.notes !== "" ||
        draft.projectId !== projectId ||
        pending.length > 0
      }
      onClose={onClose}
      actions={
        <>
          <Button type="submit" form={formId} loading={capturing.isPending}>
            Capture
          </Button>
          <span className="dialog-hint">Shape it into a Task later, in Work › Ideas.</span>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-stack"
        onSubmit={(event) => {
          event.preventDefault();
          capturing.mutate(draft);
        }}
      >
        {capturing.error && (
          <RefusalAlert
            title={
              captured
                ? "The Idea is captured, but not every Attachment yet"
                : "The Idea can't be captured yet"
            }
            error={capturing.error}
          />
        )}
        <IdeaFields draft={draft} onChange={setDraft} />
        <PendingAttachmentsField pending={pending} onChange={setPending} />
      </form>
    </Dialog>
  );
}
