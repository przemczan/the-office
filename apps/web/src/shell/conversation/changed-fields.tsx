import type { ChangedField } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { textDiff } from "../text-diff.ts";
import { UnifiedDiffView } from "../unified-diff-view.tsx";

const NONE = "None";

/**
 * Each field an Office action's call changes, before and after: a short value on a line, a long
 * text as a diff, and a Secret value by its name alone.
 */
export function ChangedFields({ fields }: { readonly fields: readonly ChangedField[] }): ReactNode {
  return (
    <ul className="proposal-changes">
      {fields.map((field) => (
        <li key={field.label}>
          <span className="proposal-change-label">{field.label}</span>
          <FieldChange field={field} />
        </li>
      ))}
    </ul>
  );
}

function FieldChange({ field }: { readonly field: ChangedField }): ReactNode {
  const { label, before, after, form } = field;
  if (form === "secret")
    return <span className="proposal-change-to">Changes this Secret value</span>;
  if (form === "long") {
    return (
      <div className="proposal-change-diff">
        <UnifiedDiffView diff={textDiff(before ?? "", after ?? "")} label={`Changes to ${label}`} />
      </div>
    );
  }
  return (
    <>
      <span className="proposal-change-from">{before ?? NONE}</span>
      <Icon name="arrow-right" size={14} aria-label="to" />
      <span className="proposal-change-to">{after ?? NONE}</span>
    </>
  );
}
