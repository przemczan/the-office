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
}): ReactNode {
  const [triedWhileBusy, setTriedWhileBusy] = useState(false);
  // Once it can send again the explanation has done its job; the next busy spell starts quiet.
  if (busyReason === undefined && triedWhileBusy) setTriedWhileBusy(false);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter that confirms a word in an input method editor is not a send.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (busyReason !== undefined) setTriedWhileBusy(true);
    else if (canSend) onSend();
  };
  return (
    <div className="message-field">
      <Textarea
        aria-label={label}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
