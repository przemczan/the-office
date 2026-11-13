import type { Attachment } from "@the-office/contracts";
import { Dialog, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { AttachmentDownloadLink } from "./attachment-download-link.tsx";
import { useAttachmentContentUrl } from "./use-attachment-content-url.ts";

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
  const original = useAttachmentContentUrl(file.id);
  return (
    <Dialog
      size="extra-large"
      keepsHeight
      maximizable
      title={file.name}
      onClose={onClose}
      actions={
        <>
          <a className="link-button" href={original} target="_blank" rel="noopener noreferrer">
            <Icon name="external-link" size={14} />
            Open the original
          </a>
          <AttachmentDownloadLink className="link-button" file={file} />
        </>
      }
    >
      {/* A new frame for a new copy: moving a frame to another address adds to the page's history. */}
      <iframe
        key={original}
        className="attachment-html-preview"
        src={original}
        sandbox="allow-scripts"
        title={file.name}
      />
    </Dialog>
  );
}
