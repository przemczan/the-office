import { Button, Icon, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { MentionField } from "../../shell/mentions/mention-field.tsx";
import { useMentions } from "../../shell/mentions/mention-picker.tsx";

/**
 * The user's own version of a record's text part, such as a Task's Plan or an Initiative's outcome.
 * `note` is what saving does beyond the words, read beside Save. With `mentions`, `@` mentions a record,
 * saved as a link to its page.
 */
export function PartEditor({
  label,
  hint,
  initial,
  note,
  mentions = false,
  saving,
  onSave,
  onCancel,
}: {
  readonly label: string;
  readonly hint: string;
  readonly initial: string;
  readonly note?: ReactNode;
  readonly mentions?: boolean;
  readonly saving: boolean;
  readonly onSave: (text: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState(initial);
  const mentioning = useMentions(text, setText);
  const field = { "aria-label": label, hint, rows: 6, value: text, autoFocus: true };
  return (
    <form
      className="task-part-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(mentions ? mentioning.linked(text) : text);
      }}
    >
      {mentions ? (
        <MentionField {...field} onChange={setText} mentions={mentioning} />
      ) : (
        <Textarea {...field} onChange={(event) => setText(event.target.value)} />
      )}
      <div className="task-part-actions">
        <Button size="sm" type="submit" loading={saving} iconLeft={<Icon name="check" size={14} />}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {note}
      </div>
    </form>
  );
}
