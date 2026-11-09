import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_IMAGE_EXTENSIONS,
  type Project,
  type ProjectImageKey,
} from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  chooseProjectImage,
  projectQueries,
  removeProjectImage,
  uploadProjectImage,
} from "../../api/projects.ts";
import { ImageRow, ImageRowEmpty } from "../../shell/image-row.tsx";
import { ProjectLogo } from "../../shell/project-logo.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import type { RepositoryFile } from "../../shell/repository-files/repository-file-browser.tsx";
import { RepositoryFileWindow } from "../../shell/repository-files/repository-file-window.tsx";
import { useToast } from "../../shell/toasts.tsx";

const IMAGE_NAMES: Readonly<Record<ProjectImageKey, string>> = { icon: "Icon", logo: "Logo" };
const WHERE_IT_SHOWS: Readonly<Record<ProjectImageKey, string>> = {
  icon: "Shows in place of the mark's letters and colour, wherever the mark shows.",
  logo: "Stands for the Project on its page and its card, in place of the mark.",
};

/** What a row is changing its image to: an upload, a file in the repository, or none. */
type ImageChange = File | RepositoryFile | null;

/** One image of the Project, saved at once when a file is picked, here or in the repository. */
export function ProjectImageRow({
  project,
  imageKey,
}: {
  readonly project: Project;
  readonly imageKey: ProjectImageKey;
}): ReactNode {
  const name = IMAGE_NAMES[imageKey];
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
  const copying =
    changing.isPending && changing.variables !== null && !(changing.variables instanceof File);
  return (
    <>
      <ImageRow
        name={name}
        hint={WHERE_IT_SHOWS[imageKey]}
        preview={<ImagePreview project={project} imageKey={imageKey} />}
        held={project[imageKey] !== null}
        changing={changing}
        otherActions={
          <Button
            variant="secondary"
            size="sm"
            loading={copying}
            disabled={changing.isPending}
            title={changing.isPending ? `The ${name} is being saved.` : undefined}
            onClick={() => setChoosing(true)}
          >
            Choose from repository
          </Button>
        }
      />
      {choosing && (
        <RepositoryFileWindow
          projectId={project.id}
          title={`Choose ${name}`}
          extensions={PROJECT_IMAGE_EXTENSIONS}
          onPick={(file) => {
            setChoosing(false);
            changing.mutate(file);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </>
  );
}

/** The image alone, as it shows; an empty place without one, rather than what shows instead. */
function ImagePreview({
  project,
  imageKey,
}: {
  readonly project: Project;
  readonly imageKey: ProjectImageKey;
}): ReactNode {
  if (project[imageKey] === null) return <ImageRowEmpty name={IMAGE_NAMES[imageKey]} />;
  return imageKey === "icon" ? (
    <ProjectMark project={project} size="xl" />
  ) : (
    <ProjectLogo project={project} size="xl" />
  );
}
