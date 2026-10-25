import { useQuery } from "@tanstack/react-query";
import type { Idea } from "@the-office/contracts";
import { Button, Dialog, RadioGroup } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useShaping } from "./use-shaping.ts";

/** An Office-wide Idea becomes a Task in one Project, chosen here. */
export function ShapeIdeaDialog({
  idea,
  onClose,
}: {
  readonly idea: Idea;
  readonly onClose: () => void;
}): ReactNode {
  const projects = useQuery(projectQueries.list());
  const [chosen, setChosen] = useState<string>();
  const projectId = chosen ?? projects.data?.[0]?.id;
  const shaping = useShaping(idea);
  return (
    <Dialog
      title="Which Project is the Task in?"
      description={`${idea.title} is Office-wide. A Task belongs to one Project.`}
      width={480}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={shaping.isPending}
            disabled={projectId === undefined}
            onClick={() => {
              if (projectId !== undefined) shaping.mutate(projectId, { onSuccess: onClose });
            }}
          >
            Shape into a Task
          </Button>
        </>
      }
    >
      {shaping.error && <RefusalAlert title="The Idea can't be shaped" error={shaping.error} />}
      <RadioGroup
        options={(projects.data ?? []).map((project) => ({
          value: project.id,
          label: <ProjectChip projectId={project.id} projects={projects.data} />,
        }))}
        value={projectId}
        onChange={setChosen}
      />
    </Dialog>
  );
}
