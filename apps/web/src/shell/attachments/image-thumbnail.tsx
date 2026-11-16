import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { IMAGE_REMOVED } from "./attachment-viewer.tsx";
import { useAttachmentContentUrl } from "./use-attachment-content-url.ts";

/**
 * An image Attachment at the thumbnail size, opening the viewer on a press. A message's image
 * (`mayBeRemoved`) points at an Attachment that can be removed after it was sent: one that can't be
 * loaded says so in its place rather than showing a broken image. An Attachment listed with its
 * owner still exists, so it always stays a thumbnail to open, whatever its bytes.
 */
export function ImageThumbnail({
  image,
  mayBeRemoved = false,
  onView,
}: {
  readonly image: { readonly id: string; readonly name: string };
  readonly mayBeRemoved?: boolean;
  readonly onView: () => void;
}): ReactNode {
  const src = useAttachmentContentUrl(image.id);
  const [failed, setFailed] = useState<string>();
  if (mayBeRemoved && failed === src) {
    return (
      <span className="attachment-thumbnail attachment-thumbnail-removed" title={image.name}>
        <Icon name="image-off" size={14} />
        {IMAGE_REMOVED}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="attachment-thumbnail"
      aria-label={`View ${image.name}`}
      onClick={onView}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={mayBeRemoved ? () => setFailed(src) : undefined}
      />
    </button>
  );
}
