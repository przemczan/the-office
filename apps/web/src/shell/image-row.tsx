import type { UseMutationResult } from "@tanstack/react-query";
import { IMAGE_MEDIA_TYPES, IMAGE_UPLOAD_BYTES } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useRef, useState, type ReactNode } from "react";
import "./image-row.css";

export const IMAGE_LIMIT_IN_MB = IMAGE_UPLOAD_BYTES / 1024 / 1024;

/** The save behind a row: `File` uploads, null removes, `Other` is whatever else the row offers. */
export type ImageChanging<Other = never> = UseMutationResult<unknown, Error, File | Other | null>;

/**
 * One image, previewed as it shows, saved at once when a file is picked. A refusal stays in the
 * row, and the image stays as it was.
 */
export function ImageRow<Other = never>({
  name,
  hint,
  preview,
  held,
  changing,
  otherActions,
  readOnly = false,
}: {
  /** What the image is called. */
  readonly name: string;
  readonly hint: string;
  /** The image as it shows, or `ImageRowEmpty` while there is none. */
  readonly preview: ReactNode;
  /** There is an image, to replace or remove. */
  readonly held: boolean;
  readonly changing: ImageChanging<Other>;
  /** More ways to change the image, between Upload and Remove. */
  readonly otherActions?: ReactNode;
  /** Shows the image alone, with nothing to change it by. */
  readonly readOnly?: boolean;
}): ReactNode {
  const fileInput = useRef<HTMLInputElement>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const uploading = changing.isPending && changing.variables instanceof File;
  const removing = changing.isPending && changing.variables === null;
  const whyDisabled = changing.isPending ? `The ${name} is being saved.` : undefined;
  const pick = (file: File): void => {
    changing.reset();
    const fits = file.size <= IMAGE_UPLOAD_BYTES;
    setTooLarge(!fits);
    if (fits) changing.mutate(file);
  };
  // Any save since the file too large was picked leaves the mutation no longer idle.
  const problem =
    tooLarge && changing.isIdle
      ? `An image may be at most ${IMAGE_LIMIT_IN_MB} MB.`
      : changing.error?.message;
  return (
    <div className="image-row" role="group" aria-label={name}>
      <div className="image-row-preview">{preview}</div>
      <div className="image-row-words">
        <div className="image-row-name">{name}</div>
        <div className="image-row-hint">{hint}</div>
        {problem && (
          <p className="image-row-error" role="alert">
            {problem}
          </p>
        )}
      </div>
      {!readOnly && (
        <>
          <input
            ref={fileInput}
            className="image-row-input"
            type="file"
            accept={IMAGE_MEDIA_TYPES.join(",")}
            aria-label={`${name} file`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so that picking the same file again still reads as a change.
              event.target.value = "";
              if (file) pick(file);
            }}
          />
          <div className="image-row-actions">
            <Button
              variant="secondary"
              size="sm"
              loading={uploading}
              disabled={changing.isPending}
              title={whyDisabled}
              onClick={() => fileInput.current?.click()}
            >
              {held ? "Replace" : "Upload"}
            </Button>
            {otherActions}
            {held && (
              <Button
                variant="danger-ghost"
                size="sm"
                loading={removing}
                disabled={changing.isPending}
                title={whyDisabled}
                onClick={() => changing.mutate(null)}
              >
                Remove
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** An empty place for the image, rather than what shows instead of it. */
export function ImageRowEmpty({ name }: { readonly name: string }): ReactNode {
  return <span className="image-row-empty">No {name}</span>;
}
