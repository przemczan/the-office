import { Textarea } from "@the-office/ui";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import "./conversation.css";

/**
 * A field the user writes a message in: the Composer, a Decision's free answer, a Gate's feedback.
 * Every one sends on Enter and breaks the line on Shift+Enter; while it can't send, Enter says why
 * instead of doing nothing.
 */
export function MessageField({
  label,
  placeholder,
  rows,
  value,
  onChange,
  canSend,
  busyReason,
  onSend,
  autoFocus,
  onKeyDownFirst,
  onCaret,
  above,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly rows: number;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** There is something to send and nothing in the way. */
  readonly canSend: boolean;
  /** Why a message can't be sent now, such as the person still answering; undefined when it can. */
  readonly busyReason: string | undefined;
  readonly onSend: () => void;
  readonly autoFocus?: boolean;
  /** Takes a key before the field does, as a picker open over it; true when it was handled. */
  readonly onKeyDownFirst?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** The field, each time its text or caret changes. */
  readonly onCaret?: (field: HTMLTextAreaElement) => void;
  /** What sits right over the field, inside it, such as the images the message carries. */
  readonly above?: ReactNode;
}): ReactNode {
  const [triedWhileBusy, setTriedWhileBusy] = useState(false);
  // Once it can send again the explanation has done its job; the next busy spell starts quiet.
  if (busyReason === undefined && triedWhileBusy) setTriedWhileBusy(false);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (onKeyDownFirst?.(event)) return;
    // Enter that confirms a word in an input method editor is not a send.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (busyReason !== undefined) setTriedWhileBusy(true);
    else if (canSend) onSend();
  };
  return (
    <div className="message-field">
      {above}
      <Textarea
        aria-label={label}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onCaret?.(event.target);
        }}
        onSelect={(event) => onCaret?.(event.currentTarget)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
      />
      {triedWhileBusy && busyReason !== undefined && (
        <p className="message-field-busy" role="status">
          {busyReason}
        </p>
      )}
    </div>
  );
}
