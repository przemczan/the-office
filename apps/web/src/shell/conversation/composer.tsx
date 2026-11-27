import {
  messageCommand,
  type OfficeCommandName,
  type OpenPage,
  type SkillCommand,
} from "@the-office/contracts";
import { Button, Icon, IconButton } from "@the-office/ui";
import {
  useEffect,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { pastedFiles } from "../attachments/pasted-files.ts";
import { useCommands } from "../commands/command-picker.tsx";
import { useMentions } from "../mentions/mention-picker.tsx";
import { MessageField } from "./message-field.tsx";
import { useMessageImages, type UploadMessageImages } from "./message-images.ts";
import { PendingMessageImages } from "./pending-message-images.tsx";

/** A Handover note a Link card prefilled, and its writer as every surface names a person. */
export interface PrefilledNote {
  readonly text: string;
  readonly writer: string;
}

/**
 * Writes the next message, with the keys every message field has; `@` mentions a Task, an open
 * Decision or an Idea, which the person then reads, or the Open page where one is given. A Handover
 * note a Link card gave starts the draft, for the user to edit or leave out (spec §2.2). Given
 * `onOfficeCommand`, "/" lists the commands, and an Office command is carried out here rather than
 * sent (spec §2.4). Images pasted or dropped into the box wait over the field until Send, which
 * uploads them through `onSend`.
 */
export function Composer({
  placeholder,
  busy,
  busyHint,
  prefilledNote,
  startingDraft,
  autoFocus = true,
  openPage,
  onSend,
  onLeaveNoteOut,
  onDrafting,
  onDraftChange,
  skillCommands = [],
  onOfficeCommand,
  commandNote,
  onCloseCommandNote,
  stop,
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
  /** The page open beside the chat drawer, which the `@` picker offers first (spec §2.4). */
  readonly openPage?: OpenPage | undefined;
  /**
   * Resolves once the message is taken; the draft and its images are kept when it rejects.
   * `fromNote` says the message started from the prefilled Handover note. `uploadImages` uploads
   * the images waiting in the box to the Thread and answers their Attachment ids for the message;
   * after a refusal it uploads only those not uploaded yet.
   */
  readonly onSend: (
    text: string,
    fromNote: boolean,
    uploadImages: UploadMessageImages,
  ) => Promise<unknown>;
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
  /** Stop, between Mention and Send, while the person answers (spec §2.4.5). */
  readonly stop?: ReactNode;
}): ReactNode {
  const [draft, setDraft] = useState(startingDraft ?? prefilledNote?.text ?? "");
  const [noteKept, setNoteKept] = useState(prefilledNote !== undefined);
  const note = noteKept ? prefilledNote : undefined;
  const [sending, setSending] = useState(false);
  const mentions = useMentions(draft, setDraft, openPage);
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
  const images = useMessageImages(officeCommand?.kind === "skill");
  const [dropping, setDropping] = useState(false);
  const drafting = draft.trim() !== "";
  // A message may be images alone, as the service takes it.
  const hasMessage = drafting || images.pending.length > 0;
  // Images waiting are as much a draft as words: the box mustn't go while they wait.
  useEffect(() => onDrafting?.(hasMessage), [hasMessage, onDrafting]);
  useEffect(() => onDraftChange?.(draft), [draft, onDraftChange]);
  // An Office command never reaches the person, so nothing they are doing holds it back.
  const runsOfficeCommand = officeCommand?.kind === "office";
  const imagesKept = images.problems.length === 0;
  const canSend = !sending && hasMessage && (runsOfficeCommand || (!busy && imagesKept));
  const send = async (): Promise<void> => {
    if (!canSend) return;
    onCloseCommandNote?.();
    if (officeCommand?.kind === "office") {
      setDraft("");
      onOfficeCommand?.(officeCommand.name);
      return;
    }
    setSending(true);
    // Images pasted while it is sent wait for the next message.
    const sentImages = images.pending.map(({ key }) => key);
    try {
      await onSend(mentions.linked(draft), note !== undefined, images.upload);
      setDraft("");
      setNoteKept(false);
      mentions.clear();
      images.removeSent(sentImages);
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
  // Only a paste of files: one with text in it pastes as text (`pastedFiles`).
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = pastedFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    // A dialog taking pastes anywhere in the page (`usePastedFiles`) mustn't take these too.
    event.stopPropagation();
    images.add(files);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    // Moving over the box's own parts leaves one of them, not the box.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropping(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setDropping(false);
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    images.add([...event.dataTransfer.files]);
  };
  const sendLabel = busy && !runsOfficeCommand ? busyHint : sendWords(imagesKept);
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
      <div
        className="composer"
        data-dropping={dropping || undefined}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
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
          above={<PendingMessageImages images={images} disabled={sending} />}
        />
        <IconButton
          icon={<Icon name="at-sign" size={16} />}
          label="Mention a Task, Decision or Idea"
          variant="ghost"
          onClick={mentions.start}
        />
        {stop}
        <IconButton
          icon={<Icon name="arrow-up" size={16} />}
          label={sendLabel}
          variant="primary"
          disabled={!canSend}
          onClick={() => void send()}
        />
      </div>
    </>
  );
}

/** The send button's words: what it does, or, while an image breaks a rule, why it can't. */
function sendWords(imagesKept: boolean): string {
  return imagesKept ? "Send (Enter)" : "Remove the images that can't be sent first";
}
