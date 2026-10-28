import { useQuery } from "@tanstack/react-query";
import type { AttachmentOwner } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { attachmentQueries } from "../../api/work.ts";
import { AddAttachmentDialog } from "../../shell/attachments/add-attachment-dialog.tsx";
import { AttachmentChips } from "../../shell/attachments/attachment-chips.tsx";
import { RecordBlock } from "./record-block.tsx";

/** A Task's or an Initiative's Attachments on its record, with Add. */
export function AttachmentsBlock({
  owner,
  ownerTitle,
}: {
  readonly owner: AttachmentOwner;
  readonly ownerTitle: string;
}): ReactNode {
  const attachments = useQuery(attachmentQueries.of(owner));
  const [adding, setAdding] = useState(false);
  return (
    <RecordBlock
      icon="paperclip"
      title="Attachments"
      actions={
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          Add
        </Button>
      }
    >
      {attachments.data?.length === 0 ? (
        <p className="task-quiet">None</p>
      ) : (
        <AttachmentChips attachments={attachments.data ?? []} />
      )}
      {adding && (
        <AddAttachmentDialog
          owner={owner}
          ownerTitle={ownerTitle}
          onClose={() => setAdding(false)}
        />
      )}
    </RecordBlock>
  );
}
