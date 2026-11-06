import { Button, Icon, IconButton } from "@the-office/ui";
import { useEffect, useState, type ReactNode } from "react";
import { useMentions } from "./mention-picker.tsx";
import { MessageField } from "./message-field.tsx";

/** A Handover note a Link card prefilled, and its writer as every surface names a person. */
export interface PrefilledNote {
  readonly text: string;
  readonly writer: string;
}

/**
 * Writes the next message, with the keys every message field has; `@` mentions a Task, an open
 * Decision or an Idea, which the person then reads. A Handover note a Link card gave starts the
 * draft, for the user to edit or leave out (spec §2.2).
 */
export function Composer({
  placeholder,
  busy,
  busyHint,
  prefilledNote,
  startingDraft,
  autoFocus = true,
  onSend,
  onLeaveNoteOut,
  onDrafting,
  onDraftChange,
}: {
  readonly placeholder: string;
  /** A message can't be sent now; a draft can still be written. */
  readonly busy: boolean;
  /** Why it can't be sent, for the send button and an Enter pressed meanwhile. */
  readonly busyHint: string;
  readonly prefilledNote?: PrefilledNote;
  /**
   * A draft the user starts from, such as a question a page asks for them, or their own left here
   * earlier, which stands over `prefilledNote` as it may be that note edited.
   */
  readonly startingDraft?: string;
  readonly autoFocus?: boolean;
  /**
   * Resolves once the message is taken; the draft is kept when it rejects. `fromNote` says the
   * message started from the prefilled Handover note.
   */
  readonly onSend: (text: string, fromNote: boolean) => Promise<unknown>;
  readonly onLeaveNoteOut?: () => void;
  /** Hears whether anything is written, as a draft mustn't change hands unseen. */
  readonly onDrafting?: (drafting: boolean) => void;
  /** Hears the draft itself, for a composer that may go and come back. */
  readonly onDraftChange?: ((draft: string) => void) | undefined;
}): ReactNode {
  const [draft, setDraft] = useState(startingDraft ?? prefilledNote?.text ?? "");
  const [noteKept, setNoteKept] = useState(prefilledNote !== undefined);
  const note = noteKept ? prefilledNote : undefined;
  const [sending, setSending] = useState(false);
  const mentions = useMentions(draft, setDraft);
  const drafting = draft.trim() !== "";
  useEffect(() => onDrafting?.(drafting), [drafting, onDrafting]);
  useEffect(() => onDraftChange?.(draft), [draft, onDraftChange]);
  const canSend = !busy && !sending && drafting;
  const send = async (): Promise<void> => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(mentions.linked(draft), note !== undefined);
      setDraft("");
      setNoteKept(false);
      mentions.clear();
    } catch {
      // The caller shows why; the draft stays to send again.
    } finally {
      setSending(false);
    }
  };
  const leaveNoteOut = (): void => {
    setDraft("");
    setNoteKept(false);
    onLeaveNoteOut?.();
  };
  return (
    <>
      {note && (
        <p className="composer-note" role="note">
          <Icon name="sticky-note" size={14} />
          <span className="composer-note-text">
            Handover note from {note.writer}, prefilled. Edit it before sending, or
          </span>
          <Button size="sm" variant="secondary" onClick={leaveNoteOut}>
            Leave it out
          </Button>
        </p>
      )}
      <div className="composer">
        {mentions.picker}
        <MessageField
          label="Message"
          rows={note ? 4 : 2}
          placeholder={placeholder}
          value={draft}
          onChange={setDraft}
          canSend={canSend}
          busyReason={busy ? busyHint : undefined}
          onSend={() => void send()}
          autoFocus={autoFocus}
          onKeyDownFirst={mentions.onKeyDownFirst}
          onCaret={mentions.onCaret}
        />
        <IconButton
          icon={<Icon name="at-sign" size={16} />}
          label="Mention a Task, Decision or Idea"
          variant="ghost"
          onClick={mentions.start}
        />
        <IconButton
          icon={<Icon name="arrow-up" size={16} />}
          label={busy ? busyHint : "Send (Enter)"}
          variant="primary"
          disabled={!canSend}
          onClick={() => void send()}
        />
      </div>
    </>
  );
}
