import type { Attachment } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { useAttachmentContentUrl } from "./use-attachment-content-url.ts";

/**
 * Saves a file Attachment under its own name. A same-origin `download` link saves it whatever
 * the content's `inline` disposition says, so the service needs no download route of its own.
 */
export function AttachmentDownloadLink({
  file,
  className,
  children,
}: {
  readonly file: Pick<Attachment, "id" | "name">;
  readonly className?: string;
  /** What the link shows; the download icon and "Download" when left out. */
  readonly children?: ReactNode;
}): ReactNode {
  const href = useAttachmentContentUrl(file.id);
  return (
    <a className={className} href={href} download={file.name}>
      {children ?? (
        <>
          <Icon name="download" size={14} />
          Download
        </>
      )}
    </a>
  );
}
