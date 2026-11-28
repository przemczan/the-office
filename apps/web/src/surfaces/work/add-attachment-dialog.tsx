import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttachmentOwner } from "@the-office/contracts";
import { Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { attachmentQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { AttachmentPicker } from "../../shell/attachments/attachment-picker.tsx";
import { usePastedFiles } from "../../shell/attachments/pasted-files.ts";
import { attachAll, type PendingAttachment } from "../../shell/attachments/pending-attachment.ts";

/** Adds an Attachment to an Idea or a Task as soon as it is chosen or pasted. */
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
    mutationFn: (pending: readonly PendingAttachment[]) => attachAll(owner, pending),
    onSettled: () => queryClient.invalidateQueries(attachmentQueries.of(owner)),
    onSuccess: (attachments) => {
      showToast(`${attachments.map((attachment) => attachment.name).join(", ")} attached.`);
      onClose();
    },
  });
  usePastedFiles((files) =>
    attaching.mutate(files.map((file): PendingAttachment => ({ kind: "file", file }))),
  );
  return (
    <Dialog size="medium" title="Attach" onClose={onClose}>
      <div className="dialog-stack">
        <p className="dialog-text">
          To {ownerTitle}. A document is a Markdown file; images show as pictures. An image on the
          clipboard can be pasted here.
        </p>
        {attaching.error && <RefusalAlert title="It can't be attached" error={attaching.error} />}
        <AttachmentPicker onPick={(pending) => attaching.mutate([pending])} />
      </div>
    </Dialog>
  );
}
