import { useQuery, type UseMutationResult } from "@tanstack/react-query";
import type { Idea, Task } from "@the-office/contracts";
import { Button, Dialog, RadioGroup } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ProjectChip } from "../project-chip.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";

/**
 * An Office-wide Idea becomes a Task in one Project, chosen here: shaped into a Task, or planned
 * as one at once, by `shaping` with the chosen Project's id.
 */
export function ShapeIdeaDialog({
  idea,
  shaping,
  actionLabel,
  onClose,
}: {
  readonly idea: Idea;
  readonly shaping: UseMutationResult<Task, Error, string>;
  /** What the confirming button says, as the card's button said it. */
  readonly actionLabel: string;
  readonly onClose: () => void;
}): ReactNode {
  const projects = useQuery(projectQueries.list());
  const [chosen, setChosen] = useState<string>();
  const projectId = chosen ?? projects.data?.[0]?.id;
  return (
    <Dialog
      size="medium"
      title="Which Project is the Task in?"
      onClose={onClose}
      actions={
        <Button
          loading={shaping.isPending}
          disabled={projectId === undefined}
          onClick={() => {
            if (projectId !== undefined) shaping.mutate(projectId, { onSuccess: onClose });
          }}
        >
          {actionLabel}
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">{idea.title} is Office-wide. A Task belongs to one Project.</p>
        {shaping.error && <RefusalAlert title="The Idea can't be shaped" error={shaping.error} />}
        <RadioGroup
          options={(projects.data ?? []).map((project) => ({
            value: project.id,
            label: <ProjectChip projectId={project.id} projects={projects.data} />,
          }))}
          value={projectId}
          onChange={setChosen}
        />
      </div>
    </Dialog>
  );
}
