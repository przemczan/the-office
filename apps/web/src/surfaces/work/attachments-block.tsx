import { useQuery } from "@tanstack/react-query";
import type { Attachment, AttachmentOwner } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { attachmentQueries } from "../../api/work.ts";
import { AddAttachmentDialog } from "../../shell/attachments/add-attachment-dialog.tsx";
import { AttachmentGallery } from "../../shell/attachments/attachment-gallery.tsx";
import {
  attachmentRounds,
  oneRound,
  type AttachmentRound,
} from "../../shell/attachments/attachment-rounds.ts";
import { RecordBlock } from "./record-block.tsx";

/** A Task's or an Initiative's Attachments on its record, a Task's by round, with Add. */
export function AttachmentsBlock({
  owner,
  ownerTitle,
}: {
  readonly owner: AttachmentOwner;
  readonly ownerTitle: string;
}): ReactNode {
  const attachments = useQuery(attachmentQueries.of(owner));
  const rounds = useRoundsOf(owner, attachments.data ?? []);
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
        <AttachmentGallery rounds={rounds} />
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

/** A Task's Attachments by the rounds its Gates' send-backs made; anything else's in one. */
function useRoundsOf(
  owner: AttachmentOwner,
  attachments: readonly Attachment[],
): AttachmentRound[] {
  const taskId = owner.kind === "task" ? owner.taskId : "";
  const taskStages = useQuery({ ...pipelineQueries.taskStages(taskId), enabled: taskId !== "" });
  // Without the Stages, as when they fail to load, the rounds aren't known: all in one.
  if (owner.kind !== "task" || taskStages.isError) return oneRound(attachments);
  // Until the Stages come: nothing rather than one round that then splits.
  return taskStages.data ? attachmentRounds(attachments, taskStages.data.stages ?? []) : [];
}
