import {
  isCustomMarkColour,
  namedMarkColourSchema,
  projectMarkColourSchema,
  type CustomMarkColour,
  type Mark,
  type Project,
} from "@the-office/contracts";
import { Field, Input, SegmentedControl } from "@the-office/ui";
import type { ReactNode } from "react";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { MARK_COLOUR_LABELS } from "./project-labels.ts";

const CUSTOM_CHOICE = "custom";
// Where the user's own colour starts from, so not a token: the picker can't show a variable.
// oxlint-disable-next-line office/restricted-syntax
const FIRST_CUSTOM_COLOUR: CustomMarkColour = "#3366cc";

/** A Project's mark as it will look, with its label and colour to change. */
export function MarkPicker({
  project,
  mark,
  onChange,
}: {
  /** What the preview shows beside `mark`; a Project still being added has neither `id` nor `icon`. */
  readonly project: Pick<Project, "name"> & Partial<Pick<Project, "id" | "icon">>;
  readonly mark: Mark;
  readonly onChange: (mark: Mark) => void;
}): ReactNode {
  const custom = isCustomMarkColour(mark.colour);
  return (
    <Field label="Mark">
      <div className="mark-picker">
        <ProjectMark project={{ ...project, mark }} size="xl" />
        <Input
          aria-label="Mark label"
          value={mark.label}
          maxLength={3}
          onChange={(event) => onChange({ ...mark, label: event.target.value })}
          style={{ width: "var(--mark-label-width)" }}
        />
        <SegmentedControl
          size="sm"
          value={custom ? CUSTOM_CHOICE : mark.colour}
          options={[
            ...namedMarkColourSchema.options.map((colour) => ({
              value: colour,
              label: MARK_COLOUR_LABELS[colour],
            })),
            { value: CUSTOM_CHOICE, label: "Custom" },
          ]}
          onChange={(choice) => onChange({ ...mark, colour: colourChosen(choice, mark.colour) })}
        />
        {custom && (
          <span className="mark-picker-custom">
            <input
              type="color"
              aria-label="Custom colour"
              value={mark.colour}
              onChange={(event) =>
                onChange({ ...mark, colour: projectMarkColourSchema.parse(event.target.value) })
              }
            />
            <span className="mark-picker-custom-value">{mark.colour}</span>
          </span>
        )}
      </div>
    </Field>
  );
}

/** Choosing Custom again keeps the colour already picked. */
function colourChosen(choice: string, current: Mark["colour"]): Mark["colour"] {
  if (choice !== CUSTOM_CHOICE) return namedMarkColourSchema.parse(choice);
  return isCustomMarkColour(current) ? current : FIRST_CUSTOM_COLOUR;
}
