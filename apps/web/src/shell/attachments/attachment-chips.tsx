import { useQuery } from "@tanstack/react-query";
import type { Attachment } from "@the-office/contracts";
import { Alert, Dialog, Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { attachmentContentUrl, attachmentQueries } from "../../api/work.ts";

const KIND_ICONS: Readonly<Record<Attachment["kind"], string>> = {
  link: "link",
  document: "file-text",
  image: "image",
  file: "file",
};

/**
 * Attachments as chips that open them: a link at its address, an image in a new tab, a document
 * here as its Markdown, any other file as a download.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  readonly attachments: readonly Attachment[];
  /** Offers a remove button on each chip when given. */
  readonly onRemove?: (attachment: Attachment) => void;
}): ReactNode {
  const [reading, setReading] = useState<Attachment>();
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-chips">
      {attachments.map((attachment) => (
        <span key={attachment.id} className="attachment-chip">
          <AttachmentOpener attachment={attachment} onRead={() => setReading(attachment)} />
          {onRemove && (
            <IconButton
              size="xs"
              icon={<Icon name="x" size={12} />}
              label={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment)}
            />
          )}
        </span>
      ))}
      {reading && <DocumentDialog document={reading} onClose={() => setReading(undefined)} />}
    </div>
  );
}

function AttachmentOpener({
  attachment,
  onRead,
}: {
  readonly attachment: Attachment;
  readonly onRead: () => void;
}): ReactNode {
  const label = (
    <>
      <Icon name={KIND_ICONS[attachment.kind]} size={14} />
      {attachment.name}
    </>
  );
  if (attachment.kind === "document") {
    return (
      <button type="button" className="attachment-open" onClick={onRead}>
        {label}
      </button>
    );
  }
  const href = attachment.kind === "link" ? attachment.url : attachmentContentUrl(attachment.id);
  return attachment.kind === "file" ? (
    <a className="attachment-open" href={href} download={attachment.name}>
      {label}
    </a>
  ) : (
    <a className="attachment-open" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/** A document's Markdown, as written. */
export function DocumentDialog({
  document,
  onClose,
}: {
  readonly document: Pick<Attachment, "id" | "name">;
  readonly onClose: () => void;
}): ReactNode {
  const text = useQuery(attachmentQueries.document(document.id));
  return (
    <Dialog title={document.name} width={720} onClose={onClose}>
      {text.error && <Alert tone="danger" title={text.error.message} />}
      {text.data !== undefined && <pre className="attachment-document">{text.data}</pre>}
    </Dialog>
  );
}
