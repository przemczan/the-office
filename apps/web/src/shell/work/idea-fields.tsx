import { useQuery } from "@tanstack/react-query";
import type { NewIdea } from "@the-office/contracts";
import { Field, Input, RadioGroup } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { MentionField } from "../mentions/mention-field.tsx";
import type { Mentions } from "../mentions/mention-picker.tsx";
import { ProjectChip } from "../project-chip.tsx";

/** The radio value for an Idea with no Project. */
const OFFICE_WIDE = "";

/**
 * An Idea's title, notes and Project, as captured and as edited. `mentions` comes from `useMentions`
 * on the notes, so the caller saves `mentions.linked(draft.notes)`.
 */
export function IdeaFields({
  draft,
  onChange,
  mentions,
}: {
  readonly draft: NewIdea;
  readonly onChange: (draft: NewIdea) => void;
  readonly mentions: Mentions;
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
      <MentionField
        label="Notes"
        hint="Optional. Type @ to mention a Task, Initiative, Decision or Idea."
        rows={3}
        value={draft.notes}
        onChange={(notes) => onChange({ ...draft, notes })}
        mentions={mentions}
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
