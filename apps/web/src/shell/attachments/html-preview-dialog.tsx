import type { Attachment } from "@the-office/contracts";
import { Dialog, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { attachmentContentUrl } from "../../api/work.ts";

/**
 * An HTML file, live in a frame. The service's Content-Security-Policy keeps it sandboxed wherever
 * it opens; the frame's own `sandbox` says the same for this window.
 */
export function HtmlPreviewDialog({
  file,
  onClose,
}: {
  readonly file: Pick<Attachment, "id" | "name">;
  readonly onClose: () => void;
}): ReactNode {
  const original = attachmentContentUrl(file.id);
  return (
    <Dialog
      size="large"
      keepsHeight
      title={file.name}
      onClose={onClose}
      actions={
        <>
          <a className="link-button" href={original} target="_blank" rel="noopener noreferrer">
            <Icon name="external-link" size={14} />
            Open the original
          </a>
          <a className="link-button" href={original} download={file.name}>
            <Icon name="download" size={14} />
            Download
          </a>
        </>
      }
    >
      <iframe
        className="attachment-html-preview"
        src={original}
        sandbox="allow-scripts"
        title={file.name}
      />
    </Dialog>
  );
}
