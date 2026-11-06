import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Mark, Project } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeMark, projectQueries } from "../../api/projects.ts";
import { useToast } from "../../shell/toasts.tsx";
import { MarkPicker } from "./mark-picker.tsx";
import { ProjectBlock } from "./project-block.tsx";

/**
 * The Project's mark, saved by a button rather than at once, as a label can be briefly empty while
 * it is typed. Without a draft it shows the Project's, so a change from another tab shows here.
 */
export function AppearanceBlock({ project }: { readonly project: Project }): ReactNode {
  const [draft, setDraft] = useState<Mark>();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: (mark: Mark) => changeMark(project.id, mark),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      setDraft(undefined);
      showToast(`Mark saved for ${saved.name}.`);
    },
  });
  const changed = draft !== undefined && !sameMark(draft, project.mark);
  return (
    <ProjectBlock
      icon="palette"
      title="Appearance"
      note="The mark shows with the Project's name on every page."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) saving.mutate(draft);
        }}
      >
        <MarkPicker
          name={project.name}
          mark={draft ?? project.mark}
          onChange={(mark) => {
            saving.reset();
            setDraft(sameMark(mark, project.mark) ? undefined : mark);
          }}
        />
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
        </div>
      </form>
    </ProjectBlock>
  );
}

function sameMark(one: Mark, other: Mark): boolean {
  return one.label === other.label && one.colour === other.colour;
}
