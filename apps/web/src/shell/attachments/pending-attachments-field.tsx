import { Button, Field, Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { AttachmentPicker } from "./attachment-picker.tsx";
import { usePastedFiles } from "./pasted-files.ts";
import { pendingName, type PendingAttachment } from "./pending-attachment.ts";

/**
 * A dialog's optional Attachments, before its record is added: chips for those chosen, picked by
 * file, screenshot or link, or pasted from the clipboard anywhere in the dialog.
 */
export function PendingAttachmentsField({
  pending,
  onChange,
}: {
  readonly pending: readonly PendingAttachment[];
  readonly onChange: (pending: readonly PendingAttachment[]) => void;
}): ReactNode {
  const [picking, setPicking] = useState(false);
  usePastedFiles((files) =>
    onChange([...pending, ...files.map((file): PendingAttachment => ({ kind: "file", file }))]),
  );
  return (
    <Field label="Attachments" hint="Optional. An image on the clipboard can be pasted here too.">
      <div className="pending-attachments">
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
              onClick={() => onChange(pending.filter((_, at) => at !== index))}
            />
          </span>
        ))}
        {picking ? (
          <AttachmentPicker onPick={(attachment) => onChange([...pending, attachment])} />
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
  );
}
