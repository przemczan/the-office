import type { Attachment } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { AttachmentChips } from "./attachment-chips.tsx";
import { roundName, type AttachmentRound } from "./attachment-rounds.ts";
import { AttachmentViewer, type ViewedImage } from "./attachment-viewer.tsx";
import { ImageThumbnail } from "./image-thumbnail.tsx";

/**
 * Attachments by round: each round's images as thumbnails that open the viewer, then its other
 * Attachments as chips. With several rounds, the newest is open at the top and the earlier ones
 * folded under their headings; with one, no heading. The viewer steps through every image shown,
 * oldest first. Nothing when there are no Attachments.
 */
export function AttachmentGallery({
  rounds,
}: {
  readonly rounds: readonly AttachmentRound[];
}): ReactNode {
  const shown = rounds.filter(({ attachments }) => attachments.length > 0);
  const headed = shown.length > 1;
  const images: ViewedImage[] = shown.flatMap((round) =>
    round.attachments
      .filter(isImage)
      .map((image) => ({ image, roundName: headed ? roundName(round) : undefined })),
  );
  const [viewing, setViewing] = useState<number>();
  const view = (image: Attachment): void =>
    setViewing(images.findIndex((viewed) => viewed.image.id === image.id));
  if (shown.length === 0) return null;
  return (
    <div className="attachment-gallery">
      {headed ? (
        shown
          .toReversed()
          .map((round, index) => (
            <RoundSection key={roundName(round)} round={round} newest={index === 0} onView={view} />
          ))
      ) : (
        <RoundContent attachments={shown[0]?.attachments ?? []} onView={view} />
      )}
      {viewing !== undefined && (
        <AttachmentViewer
          images={images}
          index={viewing}
          onStep={setViewing}
          onClose={() => setViewing(undefined)}
        />
      )}
    </div>
  );
}

function RoundSection({
  round,
  newest,
  onView,
}: {
  readonly round: AttachmentRound;
  readonly newest: boolean;
  readonly onView: (image: Attachment) => void;
}): ReactNode {
  const name = roundName(round);
  const sentBackWith = round.kind === "round" ? round.sentBackWith : null;
  return (
    <details className="attachment-round" open={newest} aria-label={name}>
      <summary className="attachment-round-heading" title={sentBackWith ?? undefined}>
        <span className="attachment-round-chevron">
          <Icon name="chevron-right" size={14} />
        </span>
        <span className="attachment-round-name">{name}</span>
        {sentBackWith !== null && (
          <span className="attachment-round-feedback">Sent back: {sentBackWith}</span>
        )}
      </summary>
      <RoundContent attachments={round.attachments} onView={onView} />
    </details>
  );
}

function RoundContent({
  attachments,
  onView,
}: {
  readonly attachments: readonly Attachment[];
  readonly onView: (image: Attachment) => void;
}): ReactNode {
  const images = attachments.filter(isImage);
  return (
    <div className="attachment-round-content">
      {images.length > 0 && (
        <div className="attachment-thumbnails">
          {images.map((image) => (
            <ImageThumbnail key={image.id} image={image} onView={() => onView(image)} />
          ))}
        </div>
      )}
      <AttachmentChips attachments={attachments.filter((attachment) => !isImage(attachment))} />
    </div>
  );
}

function isImage(attachment: Attachment): boolean {
  return attachment.kind === "image";
}
