import { projectMarkColourSchema, type Mark } from "@the-office/contracts";
import { Field, Input, SegmentedControl } from "@the-office/ui";
import type { ReactNode } from "react";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { MARK_COLOUR_LABELS } from "./project-labels.ts";

/** A Project's mark as it will look, with its label and colour to change. */
export function MarkPicker({
  name,
  mark,
  onChange,
}: {
  /** The Project's name, which the preview is titled by. */
  readonly name: string;
  readonly mark: Mark;
  readonly onChange: (mark: Mark) => void;
}): ReactNode {
  return (
    <Field label="Mark">
      <div className="mark-picker">
        <ProjectMark project={{ name, mark }} size="xl" />
        <Input
          aria-label="Mark label"
          value={mark.label}
          maxLength={3}
          onChange={(event) => onChange({ ...mark, label: event.target.value })}
          style={{ width: "var(--mark-label-width)" }}
        />
        <SegmentedControl
          size="sm"
          value={mark.colour}
          options={projectMarkColourSchema.options.map((colour) => ({
            value: colour,
            label: MARK_COLOUR_LABELS[colour],
          }))}
          onChange={(colour) => onChange({ ...mark, colour: colourOf(colour) })}
        />
      </div>
    </Field>
  );
}

function colourOf(value: string): Mark["colour"] {
  return projectMarkColourSchema.parse(value);
}
