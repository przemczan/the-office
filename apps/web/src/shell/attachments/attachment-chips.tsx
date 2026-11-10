import { useQuery } from "@tanstack/react-query";
import { isHtmlFile, type Attachment } from "@the-office/contracts";
import { Alert, Dialog, Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { attachmentContentUrl, attachmentQueries } from "../../api/work.ts";
import { MarkdownDocument } from "../markdown-text.tsx";
import { HtmlPreviewDialog } from "./html-preview-dialog.tsx";

const KIND_ICONS: Readonly<Record<Attachment["kind"], string>> = {
  link: "link",
  document: "file-text",
  image: "image",
  file: "file",
};

/**
 * Attachments as chips that open them: a link at its address, an image in a new tab, a document
 * here as its Markdown, an HTML file here in its preview, any other file as a download.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  readonly attachments: readonly Attachment[];
  /** Offers a remove button on each chip when given. */
  readonly onRemove?: (attachment: Attachment) => void;
}): ReactNode {
  const [opened, setOpened] = useState<Attachment>();
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-chips">
      {attachments.map((attachment) => (
        <span key={attachment.id} className="attachment-chip">
          <AttachmentOpener attachment={attachment} onOpenHere={() => setOpened(attachment)} />
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
      {opened && <OpenedHere attachment={opened} onClose={() => setOpened(undefined)} />}
    </div>
  );
}

function AttachmentOpener({
  attachment,
  onOpenHere,
}: {
  readonly attachment: Attachment;
  readonly onOpenHere: () => void;
}): ReactNode {
  const label = (
    <>
      <Icon name={KIND_ICONS[attachment.kind]} size={14} />
      {attachment.name}
    </>
  );
  if (attachment.kind === "document" || isHtmlFile(attachment)) {
    return (
      <button type="button" className="attachment-open" onClick={onOpenHere}>
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

function OpenedHere({
  attachment,
  onClose,
}: {
  readonly attachment: Attachment;
  readonly onClose: () => void;
}): ReactNode {
  return isHtmlFile(attachment) ? (
    <HtmlPreviewDialog file={attachment} onClose={onClose} />
  ) : (
    <DocumentDialog document={attachment} onClose={onClose} />
  );
}

/** A document's Markdown, rendered as a whole file. */
export function DocumentDialog({
  document,
  onClose,
}: {
  readonly document: Pick<Attachment, "id" | "name">;
  readonly onClose: () => void;
}): ReactNode {
  const text = useQuery(attachmentQueries.document(document.id));
  return (
    <Dialog size="large" title={document.name} onClose={onClose}>
      {text.error && <Alert tone="danger" title={text.error.message} />}
      {text.data !== undefined && <MarkdownDocument text={text.data} />}
    </Dialog>
  );
}
