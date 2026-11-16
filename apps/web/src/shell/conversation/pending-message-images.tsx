import { Icon, IconButton } from "@the-office/ui";
import { useCallback, type ReactNode, type RefCallback } from "react";
import type { MessageImages, PendingMessageImage } from "./message-images.ts";

/**
 * The images waiting in a message box, as small thumbnails each with its ×, then every rule they
 * break, which keeps Send from going until the image is removed. Nothing when there are none.
 */
export function PendingMessageImages({
  images,
  disabled,
}: {
  readonly images: Pick<MessageImages, "pending" | "problems" | "remove">;
  /** While the message is sent, nothing is taken out of it. */
  readonly disabled: boolean;
}): ReactNode {
  if (images.pending.length === 0) return null;
  return (
    <div className="pending-message-images">
      <ul className="pending-message-image-list" aria-label="Images to send">
        {images.pending.map((image) => (
          <PendingThumbnail
            key={image.key}
            image={image}
            disabled={disabled}
            onRemove={() => images.remove(image.key)}
          />
        ))}
      </ul>
      {images.problems.length > 0 && (
        <ul className="pending-message-image-problems" role="alert">
          {images.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingThumbnail({
  image: { file, problem },
  disabled,
  onRemove,
}: {
  readonly image: PendingMessageImage;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const showFile = useObjectUrl(file);
  return (
    <li
      className="pending-message-image"
      data-problem={problem !== null || undefined}
      title={file.name}
    >
      {file.type.startsWith("image/") ? (
        <img ref={showFile} alt={file.name} />
      ) : (
        <span className="pending-message-image-name">
          <Icon name="file" size={14} />
          {file.name}
        </span>
      )}
      <span className="pending-message-image-remove">
        <IconButton
          icon={<Icon name="x" size={12} />}
          label={`Remove ${file.name}`}
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onRemove}
        />
      </span>
    </li>
  );
}

/**
 * Shows the file in the image it is given, at an address made for it while the image is there and
 * given back to the browser as it goes.
 */
function useObjectUrl(file: File): RefCallback<HTMLImageElement> {
  return useCallback(
    (image: HTMLImageElement | null) => {
      if (image === null) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );
}
