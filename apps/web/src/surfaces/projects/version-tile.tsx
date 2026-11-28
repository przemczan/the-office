import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IMAGE_MEDIA_TYPES,
  IMAGE_UPLOAD_BYTES,
  PROJECT_IMAGE_EXTENSIONS,
  type Image,
  type Project,
  type ProjectImageKey,
  type ProjectImagePalette,
} from "@the-office/contracts";
import { Button, Icon, PALETTES } from "@the-office/ui";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  chooseProjectImage,
  projectImageAddress,
  projectQueries,
  removeProjectImage,
  uploadProjectImage,
  type ProjectImageVersion,
} from "../../api/projects.ts";
import { IMAGE_LIMIT_IN_MB } from "../../shell/image-row.tsx";
import { otherPalette } from "../../shell/project-image.ts";
import type { RepositoryFile } from "./repository-files/repository-file-browser.tsx";
import { RepositoryFileWindow } from "./repository-files/repository-file-window.tsx";
import { useToast } from "../../shell/toasts.tsx";

/** What a tile is changing its version to: an upload, a file in the repository, or none. */
type VersionChange = File | RepositoryFile | null;

const TOO_LARGE = `An image may be at most ${IMAGE_LIMIT_IN_MB} MB.`;
const NOT_AN_IMAGE = "The file isn't a PNG, JPEG, WebP or SVG image.";

/**
 * One version of an image, previewed on its palette's own page, saved at once when a file is
 * dropped or picked, here or in the repository. A refusal stays in the tile, and the version stays
 * as it was.
 */
export function VersionTile({
  project,
  imageKey,
  imageName,
  palette,
}: {
  readonly project: Project;
  readonly imageKey: ProjectImageKey;
  /** What the image is called, such as Logo. */
  readonly imageName: string;
  readonly palette: ProjectImagePalette;
}): ReactNode {
  const versionName = `${PALETTES[palette].name} ${imageName}`;
  const image = project[imageKey][palette];
  const fallback = project[imageKey][otherPalette(palette)];
  const fileInput = useRef<HTMLInputElement>(null);
  const [choosing, setChoosing] = useState(false);
  const [draggedOver, setDraggedOver] = useState(false);
  const { changing, change, refusal } = useVersionChanging(
    project,
    { key: imageKey, palette },
    versionName,
  );
  const busy = changing.isPending;
  const whyDisabled = busy ? `The ${versionName} is being saved.` : undefined;
  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDraggedOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) change(file);
  };
  return (
    <div
      className="version-tile palette-stage"
      data-palette-stage={palette}
      role="group"
      aria-label={versionName}
    >
      <div className="version-tile-head">
        <span className="version-tile-name">{PALETTES[palette].name}</span>
        {image && (
          <span className="version-tile-held-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title={whyDisabled}
              onClick={() => fileInput.current?.click()}
            >
              Replace
            </Button>
            <Button
              variant="danger-ghost"
              size="sm"
              loading={busy && changing.variables === null}
              disabled={busy}
              title={whyDisabled}
              onClick={() => change(null)}
            >
              Remove
            </Button>
          </span>
        )}
      </div>
      <button
        type="button"
        className={`version-tile-drop${image ? " held" : ""}${draggedOver ? " dragged-over" : ""}`}
        aria-label={image ? `Replace the ${versionName}` : `Upload a ${versionName}`}
        aria-busy={busy}
        aria-disabled={busy}
        title={whyDisabled}
        onClick={() => {
          if (!busy) fileInput.current?.click();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDraggedOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDraggedOver(false)}
        onDrop={onDrop}
      >
        {image ? (
          <HeldVersion projectId={project.id} image={image} />
        ) : (
          <EmptyVersion fallbackPalette={fallback ? otherPalette(palette) : undefined} />
        )}
        {busy && (
          <span className="version-tile-busy">
            <Icon name="loader-circle" size={18} />
            Saving…
          </span>
        )}
      </button>
      <input
        ref={fileInput}
        className="version-tile-input"
        type="file"
        accept={IMAGE_MEDIA_TYPES.join(",")}
        aria-label={`${versionName} file`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so that picking the same file again still reads as a change.
          event.target.value = "";
          if (file) change(file);
        }}
      />
      {refusal && (
        <p className="version-tile-error" role="alert">
          {refusal}
        </p>
      )}
      <div className="version-tile-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          title={whyDisabled}
          onClick={() => setChoosing(true)}
        >
          Choose from repository
        </Button>
      </div>
      {choosing && (
        <RepositoryFileWindow
          projectId={project.id}
          title={`Choose ${versionName}`}
          extensions={PROJECT_IMAGE_EXTENSIONS}
          onPick={(file) => {
            setChoosing(false);
            change(file);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </div>
  );
}

/** The save of one version, with what was refused before it was sent: too large, or no image. */
function useVersionChanging(project: Project, version: ProjectImageVersion, versionName: string) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [refusedHere, setRefusedHere] = useState<string>();
  const changing = useMutation({
    mutationFn: (change: VersionChange) => {
      if (change === null) return removeProjectImage(project.id, version);
      return change instanceof File
        ? uploadProjectImage(project.id, version, change)
        : chooseProjectImage(project.id, version, change);
    },
    onSuccess: (saved, change) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast(`${versionName} ${change ? "saved" : "removed"} for ${saved.name}.`);
    },
  });
  const change = (to: VersionChange): void => {
    changing.reset();
    const problem = to instanceof File ? fileProblem(to) : undefined;
    setRefusedHere(problem);
    if (problem === undefined) changing.mutate(to);
  };
  return { changing, change, refusal: refusedHere ?? changing.error?.message };
}

/** Checked before sending, as a dropped file isn't held to the picker's kinds; the service decides. */
function fileProblem(file: File): string | undefined {
  if (file.size > IMAGE_UPLOAD_BYTES) return TOO_LARGE;
  const kinds: readonly string[] = IMAGE_MEDIA_TYPES;
  if (file.type !== "" && !kinds.includes(file.type)) return NOT_AN_IMAGE;
  return undefined;
}

function HeldVersion({
  projectId,
  image,
}: {
  readonly projectId: string;
  readonly image: Image;
}): ReactNode {
  const [failedId, setFailedId] = useState<string>();
  if (failedId === image.id) {
    return <span className="version-tile-words">The image can't be loaded.</span>;
  }
  return (
    <img
      className="version-tile-image"
      src={projectImageAddress(projectId, image.id)}
      alt=""
      onError={() => setFailedId(image.id)}
    />
  );
}

/** An empty place, saying which version shows instead when the other one is held. */
function EmptyVersion({
  fallbackPalette,
}: {
  readonly fallbackPalette: ProjectImagePalette | undefined;
}) {
  return (
    <>
      <Icon name="image-up" size={20} strokeWidth={1.6} />
      <span className="version-tile-words">
        Drop an image or <span className="version-tile-browse">browse</span>
      </span>
      {fallbackPalette && (
        <span className="version-tile-fallback">
          Uses the {PALETTES[fallbackPalette].name.toLowerCase()} version
        </span>
      )}
    </>
  );
}
