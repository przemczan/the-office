import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Idea, NewIdea } from "@the-office/contracts";
import { Button, Dialog, Field, IconButton, Icon } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { captureIdea, ideaQueries } from "../../api/work.ts";
import { AttachmentPicker } from "../attachments/attachment-picker.tsx";
import { attach, pendingName, type PendingAttachment } from "../attachments/pending-attachment.ts";
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
  const [picking, setPicking] = useState(false);
  const queryClient = useQueryClient();
  const showToast = useToast();
  // Once captured, a failed Attachment is tried again without capturing the Idea twice.
  const [captured, setCaptured] = useState<Idea>();
  const capturing = useMutation({
    mutationFn: async (newIdea: NewIdea) => {
      const idea = captured ?? (await captureIdea(newIdea));
      setCaptured(idea);
      // One at a time and in order, so they list as they were chosen, each leaving once added.
      for (const attachment of pending) {
        await attach({ kind: "idea", ideaId: idea.id }, attachment);
        setPending((left) => left.slice(1));
      }
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
        <Field label="Attachments" hint="Optional.">
          <div className="capture-idea-attachments">
            {pending.map((attachment, index) => (
              <span key={`${index}-${pendingName(attachment)}`} className="attachment-chip">
                <span className="attachment-open">
                  <Icon name={attachment.kind === "link" ? "link" : "file"} size={14} />
                  {pendingName(attachment)}
                </span>
                <IconButton
                  size="xs"
                  icon={<Icon name="x" size={12} />}
                  label={`Remove ${pendingName(attachment)}`}
                  onClick={() => setPending(pending.filter((_, at) => at !== index))}
                />
              </span>
            ))}
            {picking ? (
              <AttachmentPicker onPick={(attachment) => setPending([...pending, attachment])} />
            ) : (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Icon name="paperclip" size={14} />}
                  onClick={() => setPicking(true)}
                >
                  Add a file, screenshot or link
                </Button>
              </div>
            )}
          </div>
        </Field>
      </form>
    </Dialog>
  );
}
