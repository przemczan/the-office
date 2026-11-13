import { useQuery } from "@tanstack/react-query";
import { isHtmlFile, isPlainTextFile, type Attachment } from "@the-office/contracts";
import { Alert, Dialog, Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { attachmentQueries, SHOWN_TEXT_LIMIT } from "../../api/work.ts";
import { MarkdownDocument } from "../markdown-text.tsx";
import { AttachmentDownloadLink } from "./attachment-download-link.tsx";
import { HtmlPreviewDialog } from "./html-preview-dialog.tsx";
import { PlainTextFile } from "./plain-text-file.tsx";
import { useAttachmentContentUrl } from "./use-attachment-content-url.ts";

const KIND_ICONS: Readonly<Record<Attachment["kind"], string>> = {
  link: "link",
  document: "file-text",
  image: "image",
  file: "file",
};

/**
 * Attachments as chips that open them: a link at its address, an image in a new tab, a document
 * here as its Markdown, any other text file here as plain text, an HTML file here in its preview,
 * any other file as a download.
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
  const contentUrl = useAttachmentContentUrl(attachment.id);
  const label = (
    <>
      <Icon
        name={isPlainTextFile(attachment) ? KIND_ICONS.document : KIND_ICONS[attachment.kind]}
        size={14}
      />
      {attachment.name}
    </>
  );
  if (attachment.kind === "document" || isPlainTextFile(attachment) || isHtmlFile(attachment)) {
    return (
      <button type="button" className="attachment-open" onClick={onOpenHere}>
        {label}
      </button>
    );
  }
  if (attachment.kind === "file") {
    return (
      <AttachmentDownloadLink className="attachment-open" file={attachment}>
        {label}
      </AttachmentDownloadLink>
    );
  }
  const href = attachment.kind === "link" ? attachment.url : contentUrl;
  return (
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
    <DocumentDialog
      document={attachment}
      shownAs={isPlainTextFile(attachment) ? "plain-text" : "markdown"}
      onClose={onClose}
    />
  );
}

/**
 * A text file as a whole: a document's Markdown rendered, any other text file as plain text with
 * its line numbers; its first MB at most, with Download for the file itself.
 */
export function DocumentDialog({
  document,
  shownAs,
  onClose,
}: {
  readonly document: Pick<Attachment, "id" | "name">;
  readonly shownAs: "markdown" | "plain-text";
  readonly onClose: () => void;
}): ReactNode {
  const shown = useQuery(attachmentQueries.text(document.id));
  return (
    <Dialog
      size="extra-large"
      maximizable
      title={document.name}
      onClose={onClose}
      actions={<AttachmentDownloadLink className="link-button" file={document} />}
    >
      {shown.error && <Alert tone="danger" title={shown.error.message} />}
      {shown.data !== undefined &&
        (shownAs === "markdown" ? (
          <MarkdownDocument text={shown.data.text} />
        ) : (
          <PlainTextFile text={shown.data.text} />
        ))}
      {shown.data?.cut && (
        <p className="dialog-text">
          This is the file's first {SHOWN_TEXT_LIMIT / 1024 / 1024} MB; the rest is in the download.
        </p>
      )}
    </Dialog>
  );
}
