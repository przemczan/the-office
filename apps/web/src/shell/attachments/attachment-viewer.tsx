import { useQuery } from "@tanstack/react-query";
import type { Attachment } from "@the-office/contracts";
import { Button, Dialog, Icon } from "@the-office/ui";
import { useEffect, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { attachmentContentUrl } from "../../api/work.ts";
import { dayAndClockOf } from "../time.ts";
import { authorName } from "../work/work-words.ts";

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
  const viewed = images[index];
  const hasPrevious = index > 0;
  const hasNext = index < images.length - 1;
  useEffect(() => {
    const step = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft" && hasPrevious) onStep(index - 1);
      if (event.key === "ArrowRight" && hasNext) onStep(index + 1);
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [index, hasPrevious, hasNext, onStep]);
  if (!viewed) return null;
  const { image, roundName } = viewed;
  const original = attachmentContentUrl(image.id);
  return (
    <Dialog
      title={image.name}
      width={1040}
      onClose={onClose}
      actions={
        <>
          <span className="dialog-hint">← → to step, Esc to close</span>
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
        </>
      }
    >
      <figure className="attachment-viewer">
        <img className="attachment-viewer-image" src={original} alt={image.name} />
        <figcaption className="attachment-viewer-caption">
          <span>
            {index + 1} of {images.length}
            {roundName !== undefined && ` · ${roundName}`} · Added by{" "}
            {authorName(image.addedBy, roles)}, {dayAndClockOf(image.addedAt)}
          </span>
          <a href={original} target="_blank" rel="noopener noreferrer">
            <Icon name="external-link" size={14} />
            Open the original
          </a>
        </figcaption>
      </figure>
    </Dialog>
  );
}
