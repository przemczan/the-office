import { Button, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { RefusalAlert } from "./refusal-alert.tsx";

/**
 * A title as a text field, saved in place: Enter or Save sends it, Escape or Cancel leaves it as it
 * was. A refusal shows its reason under the field. `className` is the form's own, so a header can
 * lay it out.
 */
export function InlineTitleEdit({
  label,
  initial,
  saving,
  error,
  onSave,
  onCancel,
  className,
}: {
  /** What the field is called to a screen reader, such as "Thread title". */
  readonly label: string;
  readonly initial: string;
  readonly saving: boolean;
  readonly error: Error | null;
  readonly onSave: (title: string) => void;
  readonly onCancel: () => void;
  readonly className?: string;
}): ReactNode {
  const [title, setTitle] = useState(initial);
  return (
    <form
      {...(className !== undefined && { className })}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(title);
      }}
    >
      <Input
        aria-label={label}
        size="sm"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        autoFocus
      />
      <Button size="sm" type="submit" loading={saving}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      {error && <RefusalAlert title="The title wasn't saved" error={error} />}
    </form>
  );
}
