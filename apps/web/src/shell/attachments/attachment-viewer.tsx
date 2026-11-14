import { useQuery } from "@tanstack/react-query";
import type { Attachment } from "@the-office/contracts";
import { Button, Dialog, Icon } from "@the-office/ui";
import { useEffect, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { dayAndClockOf } from "../time.ts";
import { useSignedInUserId } from "../use-user-name.ts";
import { authorName } from "../work/work-words.ts";
import { AttachmentDownloadLink } from "./attachment-download-link.tsx";
import { useAttachmentContentUrl } from "./use-attachment-content-url.ts";

/** An image the viewer steps to, with the round it came in when there are several. */
export interface ViewedImage {
  readonly image: Attachment;
  readonly roundName: string | undefined;
}

/**
 * One image at full size, stepping through `images` by Previous and Next or the ← → keys; Esc
 * closes it.
 */
export function AttachmentViewer({
  images,
  index,
  onStep,
  onClose,
}: {
  readonly images: readonly ViewedImage[];
  readonly index: number;
  readonly onStep: (index: number) => void;
  readonly onClose: () => void;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const signedInUserId = useSignedInUserId();
  const viewed = images[index];
  const original = useAttachmentContentUrl(viewed?.image.id ?? "");
  const hasPrevious = index > 0;
  const hasNext = index < images.length - 1;
  useEffect(() => {
    const step = (event: KeyboardEvent): void => {
      // Alt+← is the browser's Back, not a step.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft" && hasPrevious) onStep(index - 1);
      if (event.key === "ArrowRight" && hasNext) onStep(index + 1);
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [index, hasPrevious, hasNext, onStep]);
  if (!viewed) return null;
  const { image, roundName } = viewed;
  return (
    <Dialog
      size="extra-large"
      maximizable
      title={image.name}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="secondary"
            iconLeft={<Icon name="chevron-left" size={14} />}
            disabled={!hasPrevious}
            onClick={() => onStep(index - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            iconRight={<Icon name="chevron-right" size={14} />}
            disabled={!hasNext}
            onClick={() => onStep(index + 1)}
          >
            Next
          </Button>
          <span className="dialog-hint">← → to step, Esc to close</span>
        </>
      }
    >
      <figure className="attachment-viewer">
        <img className="attachment-viewer-image" src={original} alt={image.name} />
        <figcaption className="attachment-viewer-caption">
          <span>
            {index + 1} of {images.length}
            {roundName !== undefined && ` · ${roundName}`} · Added by{" "}
            {authorName(image.addedBy, roles, signedInUserId)}, {dayAndClockOf(image.addedAt)}
          </span>
          <span className="attachment-viewer-links">
            <a href={original} target="_blank" rel="noopener noreferrer">
              <Icon name="external-link" size={14} />
              Open the original
            </a>
            <AttachmentDownloadLink file={image} />
          </span>
        </figcaption>
      </figure>
    </Dialog>
  );
}
