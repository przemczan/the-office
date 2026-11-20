import { TASK_KINDS, taskKindSchema, type TaskKind } from "@the-office/contracts";
import { Field, SegmentedControl } from "@the-office/ui";
import type { ReactNode } from "react";
import { KindGlyph } from "./task-state-badge.tsx";
import { BUG_OUTLINE_CURSOR, KIND_NAMES } from "./work-words.ts";

/**
 * A new Task's Kind, Feature, Bug or Chore, as New Task and the Shape window ask it: a group named
 * "Kind" whose options are tabs named by the Kind.
 */
export function KindField({
  value,
  onChange,
}: {
  readonly value: TaskKind;
  readonly onChange: (kind: TaskKind) => void;
}): ReactNode {
  return (
    <Field label="Kind">
      <div role="group" aria-label="Kind">
        <SegmentedControl
          options={TASK_KINDS.map((kind) => ({
            value: kind,
            label: KIND_NAMES[kind],
            icon: <KindGlyph kind={kind} size={13} />,
          }))}
          value={value}
          onChange={(kind) => onChange(taskKindSchema.parse(kind))}
        />
      </div>
    </Field>
  );
}

/**
 * Puts the cursor at the end of the Bug outline's "1. " in the field with this id, once the outline
 * has rendered into it.
 */
export function focusBugOutline(fieldId: string): void {
  window.setTimeout(() => {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.focus();
    field.setSelectionRange(BUG_OUTLINE_CURSOR, BUG_OUTLINE_CURSOR);
  });
}
