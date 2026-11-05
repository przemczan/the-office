import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttachmentOwner } from "@the-office/contracts";
import { Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { attachmentQueries } from "../../api/work.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { AttachmentPicker } from "./attachment-picker.tsx";
import { attach, type PendingAttachment } from "./pending-attachment.ts";

/** Adds one Attachment to an Idea or a Task as soon as it is chosen. */
export function AddAttachmentDialog({
  owner,
  ownerTitle,
  onClose,
}: {
  readonly owner: AttachmentOwner;
  /** The Idea's or Task's title, which the dialog names. */
  readonly ownerTitle: string;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const attaching = useMutation({
    mutationFn: (pending: PendingAttachment) => attach(owner, pending),
    onSuccess: async (attachment) => {
      await queryClient.invalidateQueries(attachmentQueries.of(owner));
      showToast(`${attachment.name} attached.`);
      onClose();
    },
  });
  return (
    <Dialog size="medium" title="Attach" onClose={onClose}>
      <div className="dialog-stack">
        <p className="dialog-text">
          To {ownerTitle}. A document is a Markdown file; images show as pictures.
        </p>
        {attaching.error && <RefusalAlert title="It can't be attached" error={attaching.error} />}
        <AttachmentPicker onPick={(pending) => attaching.mutate(pending)} />
      </div>
    </Dialog>
  );
}
