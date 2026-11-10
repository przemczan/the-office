import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Mark, Project } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { changeMark, projectQueries } from "../../api/projects.ts";
import { IMAGE_LIMIT_IN_MB } from "../../shell/image-row.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { AppearancePreview } from "./appearance-preview.tsx";
import { MarkPicker } from "./mark-picker.tsx";
import { ProjectBlock } from "./project-block.tsx";
import { ProjectImageVersions } from "./project-image-versions.tsx";

/**
 * The Project's mark and images beside how they look. The mark is saved by a button rather than at
 * once, as a label can be briefly empty while it is typed, and the preview shows its draft until
 * then. Without a draft it shows the Project's, so a change from another tab shows here.
 */
export function AppearanceBlock({ project }: { readonly project: Project }): ReactNode {
  const [draft, setDraft] = useState<Mark>();
  // Another tab may save the very mark being drafted, which leaves nothing to save.
  const changed = draft !== undefined && !sameMark(draft, project.mark);
  return (
    <div className="appearance">
      <div className="appearance-preview">
        <AppearancePreview
          project={{ ...project, mark: draft ?? project.mark }}
          unsaved={changed}
        />
      </div>
      <div className="appearance-edit">
        <MarkCard project={project} draft={draft} changed={changed} onDraft={setDraft} />
        <ImagesCard project={project} />
      </div>
    </div>
  );
}

function MarkCard({
  project,
  draft,
  changed,
  onDraft,
}: {
  readonly project: Project;
  readonly draft: Mark | undefined;
  /** The draft differs from the Project's mark, so there is something to save or discard. */
  readonly changed: boolean;
  readonly onDraft: Dispatch<SetStateAction<Mark | undefined>>;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: (mark: Mark) => changeMark(project.id, mark),
    onSuccess: (saved, sent) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      // An edit made while the save ran is a newer draft, and stays.
      onDraft((current) => (current === sent ? undefined : current));
      showToast(`Mark saved for ${saved.name}.`);
    },
  });
  return (
    <ProjectBlock icon="palette" title="Mark">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && draft !== undefined && !saving.isPending) saving.mutate(draft);
        }}
      >
        <MarkPicker
          projectName={project.name}
          mark={draft ?? project.mark}
          onChange={(mark) => {
            if (saving.isError) saving.reset();
            onDraft(sameMark(mark, project.mark) ? undefined : mark);
          }}
        />
        {(project.icon.light !== null || project.icon.dark !== null) && (
          <p className="project-block-note">
            The Icon shows in place of these letters. They come back if it is removed.
          </p>
        )}
        {saving.error && (
          <p className="project-block-error" role="alert">
            {saving.error.message}
          </p>
        )}
        <div className="project-row">
          <Button
            type="submit"
            size="sm"
            loading={saving.isPending}
            disabled={!changed}
            title={changed ? undefined : "Change the label or the colour to save."}
          >
            Save
          </Button>
          {changed && (
            <Button
              variant="secondary"
              size="sm"
              disabled={saving.isPending}
              title={saving.isPending ? "The mark is being saved." : undefined}
              onClick={() => {
                saving.reset();
                onDraft(undefined);
              }}
            >
              Discard
            </Button>
          )}
        </div>
      </form>
    </ProjectBlock>
  );
}

function ImagesCard({ project }: { readonly project: Project }): ReactNode {
  return (
    <ProjectBlock icon="image" title="Images">
      <p className="appearance-images-intro">
        A light and a dark version each, shown with the palette. One version alone shows in both.
        PNG, JPEG, WebP or SVG, at most {IMAGE_LIMIT_IN_MB} MB. Saved as soon as picked.
      </p>
      <div className="project-image-versions">
        <ProjectImageVersions project={project} imageKey="icon" />
        <ProjectImageVersions project={project} imageKey="logo" />
      </div>
    </ProjectBlock>
  );
}

function sameMark(one: Mark, other: Mark): boolean {
  return one.label === other.label && one.colour === other.colour;
}
