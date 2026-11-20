import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Idea, NewIdea } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { captureIdea, ideaQueries } from "../../api/work.ts";
import { attachAll, type PendingAttachment } from "../attachments/pending-attachment.ts";
import { PendingAttachmentsField } from "../attachments/pending-attachments-field.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { IdeaFields } from "./idea-fields.tsx";

/** Capture an Idea's state, its fields' and its submit's, held by the window it shows in. */
export interface CaptureIdeaForm {
  readonly formId: string;
  readonly draft: NewIdea;
  readonly onChange: (draft: NewIdea) => void;
  readonly pending: readonly PendingAttachment[];
  readonly onPendingChange: Dispatch<SetStateAction<readonly PendingAttachment[]>>;
  readonly capturing: UseMutationResult<Idea, Error, NewIdea>;
  readonly captured: Idea | undefined;
}

/**
 * Captures an Idea: a title, optional notes and Attachments, in a Project or Office-wide. The draft
 * and the Attachments are the caller's, so Create can keep them while the user switches to a Task.
 */
export function useCaptureIdea({
  draft,
  onChange,
  pending,
  onPendingChange,
  onClose,
}: {
  readonly draft: NewIdea;
  readonly onChange: (draft: NewIdea) => void;
  readonly pending: readonly PendingAttachment[];
  readonly onPendingChange: Dispatch<SetStateAction<readonly PendingAttachment[]>>;
  readonly onClose: () => void;
}): CaptureIdeaForm {
  const formId = useId();
  const queryClient = useQueryClient();
  const showToast = useToast();
  // Once captured, a failed Attachment is tried again without capturing the Idea twice.
  const [captured, setCaptured] = useState<Idea>();
  const capturing = useMutation({
    mutationFn: async (newIdea: NewIdea) => {
      const idea = captured ?? (await captureIdea(newIdea));
      setCaptured(idea);
      await attachAll({ kind: "idea", ideaId: idea.id }, pending, () =>
        onPendingChange((left) => left.slice(1)),
      );
      return idea;
    },
    onSettled: () => queryClient.invalidateQueries(ideaQueries.list()),
    onSuccess: (idea) => {
      showToast(`Idea captured: ${idea.title}.`);
      onClose();
    },
  });
  return { formId, draft, onChange, pending, onPendingChange, capturing, captured };
}

/** Capture an Idea's submit. */
export function CaptureIdeaActions({ form }: { readonly form: CaptureIdeaForm }): ReactNode {
  return (
    <>
      <Button type="submit" form={form.formId} loading={form.capturing.isPending}>
        Capture
      </Button>
      <span className="dialog-hint">Shape it into a Task later, in Work › Ideas.</span>
    </>
  );
}

/** Capture an Idea's fields; Enter in the title captures it. */
export function CaptureIdeaBody({ form }: { readonly form: CaptureIdeaForm }): ReactNode {
  const { capturing } = form;
  return (
    <form
      id={form.formId}
      className="dialog-stack"
      onSubmit={(event) => {
        event.preventDefault();
        capturing.mutate(form.draft);
      }}
    >
      {capturing.error && (
        <RefusalAlert
          title={
            form.captured
              ? "The Idea is captured, but not every Attachment yet"
              : "The Idea can't be captured yet"
          }
          error={capturing.error}
        />
      )}
      <IdeaFields draft={form.draft} onChange={form.onChange} />
      <PendingAttachmentsField pending={form.pending} onChange={form.onPendingChange} />
    </form>
  );
}
