import { useQuery } from "@tanstack/react-query";
import type { Attachment, AttachmentOwner, Initiative } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { attachmentQueries } from "../../api/work.ts";
import { BlockLoaderOrProblem } from "../../shell/block-loader.tsx";
import { AddAttachmentDialog } from "./add-attachment-dialog.tsx";
import { AttachmentGallery } from "../../shell/attachments/attachment-gallery.tsx";
import {
  attachmentRounds,
  oneRound,
  type AttachmentRound,
} from "../../shell/attachments/attachment-rounds.ts";
import { attachmentsSummary } from "./initiative-words.ts";
import { RecordBlock } from "./record-block.tsx";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";

/** A Task's Attachments in their tab, by round, with Add. */
export function AttachmentsBlock({
  owner,
  ownerTitle,
}: {
  readonly owner: AttachmentOwner;
  readonly ownerTitle: string;
}): ReactNode {
  const [adding, setAdding] = useState(false);
  return (
    <RecordBlock
      icon="paperclip"
      title="Attachments"
      actions={<AddButton onClick={() => setAdding(true)} />}
    >
      <AttachmentsBody
        owner={owner}
        ownerTitle={ownerTitle}
        adding={adding}
        onAdded={() => setAdding(false)}
      />
    </RecordBlock>
  );
}

/** An Initiative's Attachments, a fold of its record, with Add. */
export function InitiativeAttachments({
  initiative,
}: {
  readonly initiative: Initiative;
}): ReactNode {
  const owner: AttachmentOwner = { kind: "initiative", initiativeId: initiative.id };
  const fold = useFold({ kind: "initiative", id: initiative.id }, "attachments", true);
  const attachments = useQuery(attachmentQueries.of(owner));
  const [adding, setAdding] = useState(false);
  return (
    <RecordFold
      fold={fold}
      icon="paperclip"
      title="Attachments"
      summary={attachmentsSummary(attachments.data?.length ?? 0)}
      side={
        <AddButton
          onClick={() => {
            fold.open();
            setAdding(true);
          }}
        />
      }
    >
      <AttachmentsBody
        owner={owner}
        ownerTitle={initiative.name}
        adding={adding}
        onAdded={() => setAdding(false)}
      />
    </RecordFold>
  );
}

function AddButton({ onClick }: { readonly onClick: () => void }): ReactNode {
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      Add
    </Button>
  );
}

function AttachmentsBody({
  owner,
  ownerTitle,
  adding,
  onAdded,
}: {
  readonly owner: AttachmentOwner;
  readonly ownerTitle: string;
  readonly adding: boolean;
  readonly onAdded: () => void;
}): ReactNode {
  const attachments = useQuery(attachmentQueries.of(owner));
  const rounds = useRoundsOf(owner, attachments.data ?? []);
  return (
    <>
      {attachments.data?.length === 0 ? (
        <p className="task-quiet">None</p>
      ) : attachments.data && rounds ? (
        <AttachmentGallery rounds={rounds} />
      ) : (
        <BlockLoaderOrProblem
          reads={[attachments]}
          shape="rows"
          count={3}
          label="Loading the Attachments…"
        />
      )}
      {adding && <AddAttachmentDialog owner={owner} ownerTitle={ownerTitle} onClose={onAdded} />}
    </>
  );
}

/** A Task's Attachments by the rounds its Gates' send-backs made; anything else's in one. */
function useRoundsOf(
  owner: AttachmentOwner,
  attachments: readonly Attachment[],
): AttachmentRound[] | undefined {
  const taskId = owner.kind === "task" ? owner.taskId : "";
  const taskStages = useQuery({ ...pipelineQueries.taskStages(taskId), enabled: taskId !== "" });
  // Without the Stages, as when they fail to load, the rounds aren't known: all in one.
  if (owner.kind !== "task" || taskStages.isError) return oneRound(attachments);
  // Until the Stages come: none rather than one round that then splits.
  return taskStages.data && attachmentRounds(attachments, taskStages.data.stages ?? []);
}
