import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_IMAGE_EXTENSIONS,
  PROJECT_IMAGE_MEDIA_TYPES,
  PROJECT_IMAGE_UPLOAD_BYTES,
  type Project,
  type ProjectImageKey,
} from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useRef, useState, type ReactNode } from "react";
import {
  chooseProjectImage,
  projectQueries,
  removeProjectImage,
  uploadProjectImage,
} from "../../api/projects.ts";
import { ProjectLogo } from "../../shell/project-logo.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import type { RepositoryFile } from "../../shell/repository-files/repository-file-browser.tsx";
import { RepositoryFileWindow } from "../../shell/repository-files/repository-file-window.tsx";
import { useToast } from "../../shell/toasts.tsx";

const LIMIT_IN_MB = PROJECT_IMAGE_UPLOAD_BYTES / 1024 / 1024;
const IMAGE_NAMES: Readonly<Record<ProjectImageKey, string>> = { icon: "Icon", logo: "Logo" };

/** What a row is changing its image to: an upload, a file in the repository, or none. */
type ImageChange = File | RepositoryFile | null;

/**
 * One image of the Project, previewed as it shows, saved at once when a file is picked, here or in
 * the repository. A refusal stays in the row, and the Project keeps the image it had.
 */
export function ProjectImageRow({
  project,
  imageKey,
}: {
  readonly project: Project;
  readonly imageKey: ProjectImageKey;
}): ReactNode {
  const name = IMAGE_NAMES[imageKey];
  const fileInput = useRef<HTMLInputElement>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const changing = useMutation({
    mutationFn: (change: ImageChange) => {
      if (change === null) return removeProjectImage(project.id, imageKey);
      return change instanceof File
        ? uploadProjectImage(project.id, imageKey, change)
        : chooseProjectImage(project.id, imageKey, change);
    },
    onSuccess: (saved, change) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast(`${name} ${change ? "saved" : "removed"} for ${saved.name}.`);
    },
  });
  const uploading = changing.isPending && changing.variables instanceof File;
  const removing = changing.isPending && changing.variables === null;
  const copying = changing.isPending && !uploading && !removing;
  const pick = (file: File): void => {
    changing.reset();
    const fits = file.size <= PROJECT_IMAGE_UPLOAD_BYTES;
    setTooLarge(!fits);
    if (fits) changing.mutate(file);
  };
  const choose = (file: RepositoryFile): void => {
    setChoosing(false);
    setTooLarge(false);
    changing.mutate(file);
  };
  const problem = tooLarge ? `An image may be at most ${LIMIT_IN_MB} MB.` : changing.error?.message;
  return (
    <div className="project-image-row" role="group" aria-label={name}>
      <div className="project-image-preview">
        {imageKey === "icon" ? (
          <ProjectMark project={project} size="xl" />
        ) : (
          <ProjectLogo project={project} size="xl" />
        )}
      </div>
      <div className="project-image-words">
        <div className="project-image-name">{name}</div>
        <div className="project-image-hint">PNG, JPEG, WebP or SVG, at most {LIMIT_IN_MB} MB</div>
        {problem && (
          <p className="project-block-error" role="alert">
            {problem}
          </p>
        )}
      </div>
      <input
        ref={fileInput}
        className="project-image-input"
        type="file"
        accept={PROJECT_IMAGE_MEDIA_TYPES.join(",")}
        aria-label={`${name} file`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so that picking the same file again still reads as a change.
          event.target.value = "";
          if (file) pick(file);
        }}
      />
      <div className="project-image-actions">
        <Button
          variant="secondary"
          size="sm"
          loading={uploading}
          disabled={changing.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {project[imageKey] ? "Replace" : "Upload"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          loading={copying}
          disabled={changing.isPending}
          onClick={() => setChoosing(true)}
        >
          Choose from repository
        </Button>
        {project[imageKey] && (
          <Button
            variant="danger-ghost"
            size="sm"
            loading={removing}
            disabled={changing.isPending}
            onClick={() => {
              setTooLarge(false);
              changing.mutate(null);
            }}
          >
            Remove
          </Button>
        )}
      </div>
      {choosing && (
        <RepositoryFileWindow
          projectId={project.id}
          title={`Choose ${name}`}
          extensions={PROJECT_IMAGE_EXTENSIONS}
          onPick={choose}
          onClose={() => setChoosing(false)}
        />
      )}
    </div>
  );
}
