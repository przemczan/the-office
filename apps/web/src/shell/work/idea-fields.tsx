import { useQuery } from "@tanstack/react-query";
import type { NewIdea } from "@the-office/contracts";
import { Field, Input, RadioGroup, Textarea } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ProjectChip } from "../project-chip.tsx";

/** The radio value for an Idea with no Project. */
const OFFICE_WIDE = "";

/** An Idea's title, notes and Project, as captured and as edited. */
export function IdeaFields({
  draft,
  onChange,
}: {
  readonly draft: NewIdea;
  readonly onChange: (draft: NewIdea) => void;
}): ReactNode {
  const projects = useQuery(projectQueries.list());
  return (
    <>
      <Input
        label="Idea"
        placeholder="Show battery level on the device list"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        autoFocus
      />
      <Textarea
        label="Notes"
        hint="Optional."
        rows={3}
        value={draft.notes}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
      />
      <Field label="Where">
        <RadioGroup
          options={[
            {
              value: OFFICE_WIDE,
              label: <ProjectChip projectId={null} projects={projects.data} />,
            },
            ...(projects.data ?? []).map((project) => ({
              value: project.id,
              label: <ProjectChip projectId={project.id} projects={projects.data} />,
            })),
          ]}
          value={draft.projectId ?? OFFICE_WIDE}
          onChange={(value) =>
            onChange({ ...draft, projectId: value === OFFICE_WIDE ? null : value })
          }
        />
      </Field>
    </>
  );
}
