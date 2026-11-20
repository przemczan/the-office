import { useQuery, type UseMutationResult } from "@tanstack/react-query";
import type { Idea, Task, TaskKind } from "@the-office/contracts";
import { Button, Dialog, Field, RadioGroup } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ProjectChip } from "../project-chip.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { KindField } from "./kind-field.tsx";

/** What an Idea becomes a Task as: its Project, and its Kind where one is asked (Feature if not). */
export interface IdeaShapeChoice {
  readonly projectId: string;
  readonly kind?: TaskKind;
}

/**
 * An Office-wide Idea becomes a Task in one Project, chosen here: shaped into a Task, or planned
 * as one at once, by `shaping` with the chosen Project's id. Given a `kind`, shaping asks the Kind
 * too, starting at it, as New Task does.
 */
export function ShapeIdeaDialog({
  idea,
  shaping,
  kind: startingKind,
  actionLabel,
  onClose,
}: {
  readonly idea: Idea;
  readonly shaping: UseMutationResult<Task, Error, IdeaShapeChoice>;
  /** The Kind the user picked to shape it as; undefined where no Kind is asked, as in planning. */
  readonly kind?: TaskKind;
  /** What the confirming button says, as the card's button said it. */
  readonly actionLabel: string;
  readonly onClose: () => void;
}): ReactNode {
  const projects = useQuery(projectQueries.list());
  const [chosen, setChosen] = useState<string>();
  const [kind, setKind] = useState(startingKind);
  const projectId = chosen ?? projects.data?.[0]?.id;
  return (
    <Dialog
      size="medium"
      title="Which Project is the Task in?"
      unsavedChanges={chosen !== undefined || kind !== startingKind}
      onClose={onClose}
      actions={
        <Button
          loading={shaping.isPending}
          disabled={projectId === undefined}
          onClick={() => {
            if (projectId === undefined) return;
            shaping.mutate({ projectId, ...(kind && { kind }) }, { onSuccess: onClose });
          }}
        >
          {actionLabel}
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">{idea.title} is Office-wide. A Task belongs to one Project.</p>
        {shaping.error && <RefusalAlert title="The Idea can't be shaped" error={shaping.error} />}
        {kind && <KindField value={kind} onChange={setKind} />}
        <Field label="Project">
          <RadioGroup
            options={(projects.data ?? []).map((project) => ({
              value: project.id,
              label: <ProjectChip projectId={project.id} projects={projects.data} />,
            }))}
            value={projectId}
            onChange={setChosen}
          />
        </Field>
      </div>
    </Dialog>
  );
}
