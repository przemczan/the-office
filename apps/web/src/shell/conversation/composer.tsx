import { messageCommand, type OfficeCommandName, type SkillCommand } from "@the-office/contracts";
import { Button, Icon, IconButton } from "@the-office/ui";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useCommands } from "../commands/command-picker.tsx";
import { useMentions } from "../mentions/mention-picker.tsx";
import { MessageField } from "./message-field.tsx";

/** A Handover note a Link card prefilled, and its writer as every surface names a person. */
export interface PrefilledNote {
  readonly text: string;
  readonly writer: string;
}

/**
 * Writes the next message, with the keys every message field has; `@` mentions a Task, an open
 * Decision or an Idea, which the person then reads. A Handover note a Link card gave starts the
 * draft, for the user to edit or leave out (spec §2.2). Given `onOfficeCommand`, "/" lists the
 * commands, and an Office command is carried out here rather than sent (spec §2.4).
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
  skillCommands = [],
  onOfficeCommand,
  commandNote,
  onCloseCommandNote,
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
  /** The Thread's skill commands, listed after the Office commands. */
  readonly skillCommands?: readonly SkillCommand[];
  /**
   * Carries out an Office command written as the message, which is then cleared and never sent.
   * Without it, as in a Stage Thread, "/" is ordinary text and every message is sent.
   */
  readonly onOfficeCommand?: ((name: OfficeCommandName) => void) | undefined;
  /** What an Office command answered, above the composer, until Esc or the next message. */
  readonly commandNote?: ReactNode;
  readonly onCloseCommandNote?: (() => void) | undefined;
}): ReactNode {
  const [draft, setDraft] = useState(startingDraft ?? prefilledNote?.text ?? "");
  const [noteKept, setNoteKept] = useState(prefilledNote !== undefined);
  const note = noteKept ? prefilledNote : undefined;
  const [sending, setSending] = useState(false);
  const mentions = useMentions(draft, setDraft);
  const commands = useCommands(
    draft,
    setDraft,
    onOfficeCommand === undefined ? undefined : skillCommands,
  );
  const officeCommand =
    onOfficeCommand === undefined
      ? undefined
      : messageCommand(
          draft,
          skillCommands.map(({ name }) => name),
        );
  const drafting = draft.trim() !== "";
  useEffect(() => onDrafting?.(drafting), [drafting, onDrafting]);
  useEffect(() => onDraftChange?.(draft), [draft, onDraftChange]);
  // An Office command never reaches the person, so nothing they are doing holds it back.
  const runsOfficeCommand = officeCommand?.kind === "office";
  const canSend = !sending && drafting && (runsOfficeCommand || !busy);
  const send = async (): Promise<void> => {
    if (!canSend) return;
    onCloseCommandNote?.();
    if (officeCommand?.kind === "office") {
      setDraft("");
      onOfficeCommand?.(officeCommand.name);
      return;
    }
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
  const onKeyDownFirst = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (commands.onKeyDownFirst(event) || mentions.onKeyDownFirst(event)) return true;
    if (event.key !== "Escape" || commandNote === undefined || onCloseCommandNote === undefined) {
      return false;
    }
    // The note is the innermost thing open: Esc closes it, not the chat around it.
    event.stopPropagation();
    event.preventDefault();
    onCloseCommandNote();
    return true;
  };
  return (
    <>
      {commandNote}
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
        {commands.picker || mentions.picker}
        <MessageField
          label="Message"
          rows={note ? 4 : 2}
          placeholder={placeholder}
          value={draft}
          onChange={setDraft}
          canSend={canSend}
          busyReason={busy && !runsOfficeCommand ? busyHint : undefined}
          onSend={() => void send()}
          autoFocus={autoFocus}
          onKeyDownFirst={onKeyDownFirst}
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
          label={busy && !runsOfficeCommand ? busyHint : "Send (Enter)"}
          variant="primary"
          disabled={!canSend}
          onClick={() => void send()}
        />
      </div>
    </>
  );
}
