import { Button, Icon, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";

/** The user's own version of a record's text part, such as a Task's Plan or an Initiative's outcome. */
export function PartEditor({
  label,
  hint,
  initial,
  saveLabel,
  saving,
  onSave,
  onCancel,
}: {
  readonly label: string;
  readonly hint: string;
  readonly initial: string;
  readonly saveLabel: string;
  readonly saving: boolean;
  readonly onSave: (text: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState(initial);
  return (
    <form
      className="task-part-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text);
      }}
    >
      <Textarea
        aria-label={label}
        hint={hint}
        rows={6}
        value={text}
        onChange={(event) => setText(event.target.value)}
        autoFocus
      />
      <div className="task-part-actions">
        <Button size="sm" type="submit" loading={saving} iconLeft={<Icon name="check" size={14} />}>
          {saveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
