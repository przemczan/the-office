import { Textarea, type TextareaProps } from "@the-office/ui";
import type { ReactNode } from "react";
import type { Mentions } from "./mention-picker.tsx";

/**
 * A text field the user can mention records in with `@`, such as a Task's Description: the picker
 * opens under it, and its keys go to the picker first. `mentions` comes from `useMentions` on the
 * same text, so the caller saves `mentions.linked(value)`.
 */
export function MentionField({
  mentions,
  value,
  onChange,
  ...textarea
}: Omit<TextareaProps, "value" | "onChange" | "onKeyDown" | "onSelect"> & {
  readonly mentions: Mentions;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <div className="mention-field">
      <Textarea
        {...textarea}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          mentions.onCaret(event.target);
        }}
        onSelect={(event) => mentions.onCaret(event.currentTarget)}
        onKeyDown={(event) => mentions.onKeyDownFirst(event)}
      />
      {mentions.picker}
    </div>
  );
}
