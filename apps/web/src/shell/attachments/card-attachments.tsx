import type { Attachment } from "@the-office/contracts";
import type { ReactNode } from "react";
import { AttachmentGallery } from "./attachment-gallery.tsx";
import { oneRound } from "./attachment-rounds.ts";

/**
 * A card that asks something, with what to look at beside it when it has the room and under it when
 * it hasn't. Only the card's own width counts: it shows full width on a page and narrow in a panel.
 */
export function CardColumns({
  side,
  children,
}: {
  /** Nothing to look at leaves the card as it is. */
  readonly side: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  if (!side) return children;
  return (
    <div className="card-columns-place">
      <div className="card-columns">
        <div>{children}</div>
        <div>{side}</div>
      </div>
    </div>
  );
}

/**
 * Attachments on a card, as the gallery shows them: pictures at the one screenshot size with the
 * viewer, the others as chips. Past a height they scroll, so the card stays small.
 */
export function CardAttachments({
  title,
  attachments,
}: {
  readonly title: string;
  readonly attachments: readonly Attachment[];
}): ReactNode {
  return (
    <section className="card-attachments" aria-label={title}>
      <div className="card-attachments-head">
        {title} · {attachments.length}
      </div>
      <div className="card-attachments-scroll">
        <AttachmentGallery rounds={oneRound(attachments)} />
      </div>
    </section>
  );
}
