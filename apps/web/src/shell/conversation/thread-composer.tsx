import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type NewMessage,
  type OfficeCommandName,
  type OpenPage,
  type Thread,
} from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useCallback, useState, type ReactNode } from "react";
import { chooseContextOverride, sendMessage, threadQueries } from "../../api/conversations.ts";
import { CommandHelp, CommandNote } from "../commands/command-notes.tsx";
import { roleQueries } from "../../api/people.ts";
import { AlarmNote } from "../fire-alarm/alarm-note.tsx";
import { mentionsOpenPage } from "../mentions/mention-words.ts";
import { roleName } from "../person-name.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { SubAgentsAndProcessesLine } from "../sub-agents-and-processes/sub-agents-and-processes-line.tsx";
import { Composer } from "./composer.tsx";
import { ContextReading, SessionRow } from "./context-reading.tsx";
import { threadReadingLook } from "./context-reading-words.ts";
import { useHandoverNotes } from "./handover-notes.tsx";
import type { UploadMessageImages } from "./message-images.ts";
import { useThreadDrafts } from "./thread-drafts.tsx";
import { takesMessages, writingPlaceholder } from "./thread-writing.ts";

/**
 * Writing in a Thread: the composer with whatever waits to go in it, or why nothing more can be
 * written. A chat keys it by the Thread's id, as the composer owns the draft once it has read it;
 * the timeline doesn't, so its draft goes with the To line. A chat's Thread may have one waiting, and
 * a composer that `keepsDraft` leaves its own there, for when it comes back. Given the Open page, as
 * the chat drawer is, the `@` picker offers it, and a message that mentions it goes with it. Right
 * above the message input, or the note saying why there is none, the line says what Sub-agents and
 * Processes the session runs (spec 2.9), and beside it, where a message can be written, the context
 * reading says how full the session's context is (spec §2.5).
 */
export function ThreadComposer({
  thread,
  personName,
  readOnlyReason,
  autoFocus = true,
  placeholder,
  keepsDraft = false,
  openPage,
  onDrafting,
  onSent,
  onShowSubAgentsAndProcesses,
}: {
  readonly thread: Thread;
  readonly personName: string;
  /** Why nothing more can be written here; the Thread stays readable and has no composer. */
  readonly readOnlyReason?: string | undefined;
  /** Focus scrolls the page, so a composer that isn't the page's whole point leaves it out. */
  readonly autoFocus?: boolean;
  /** The words of a place that already says when a message lands. */
  readonly placeholder?: string;
  /** The composer goes as the user looks elsewhere, and what they wrote mustn't go with it. */
  readonly keepsDraft?: boolean;
  /** The page open beside the chat drawer, which a message mentioning it goes with (spec §2.4). */
  readonly openPage?: OpenPage | undefined;
  readonly onDrafting?: (drafting: boolean) => void;
  readonly onSent?: (threadId: string) => void;
  /** What the Sub-agents and processes line does instead of opening its window. */
  readonly onShowSubAgentsAndProcesses?: (() => void) | undefined;
}): ReactNode {
  const threadId = thread.id;
  const roles = useQuery(roleQueries.list()).data;
  const handoverNotes = useHandoverNotes();
  const [handoverNote] = useState(() => handoverNotes.waitingIn(threadId));
  const threadDrafts = useThreadDrafts();
  const [startingDraft] = useState(() => threadDrafts.waitingIn(threadId));
  const leaveDraft = useCallback(
    (draft: string) => threadDrafts.leave(threadId, draft),
    [threadDrafts, threadId],
  );
  const queryClient = useQueryClient();
  const sending = useMutation({
    // The images go first, so the message names them; a retry uploads only those still to go.
    mutationFn: async ({ message, uploadImages }: SentMessage) => {
      const images = await uploadImages(threadId);
      return sendMessage(threadId, { ...message, ...(images.length > 0 && { images }) });
    },
    onSuccess: async (answering, { message: { handoverNoteFrom } }) => {
      if (handoverNoteFrom !== undefined) handoverNotes.clear(threadId);
      threadDrafts.clear(threadId);
      queryClient.setQueryData(threadQueries.one(answering.id).queryKey, answering);
      onSent?.(answering.id);
      await queryClient.invalidateQueries(threadQueries.messages(answering.id));
    },
  });
  const commands = useOfficeCommands(thread);
  const closed = !takesMessages(thread);
  return (
    <>
      {sending.error && <RefusalAlert title="The message wasn't sent" error={sending.error} />}
      {commands.error && <RefusalAlert title="That didn't change" error={commands.error} />}
      {readOnlyReason === undefined && !thread.stageThread && (
        // A Stage's session is held at its safe point instead.
        <AlarmNote threadId={threadId} personName={personName} />
      )}
      <SessionRow
        line={
          <SubAgentsAndProcessesLine
            thread={thread}
            personName={personName}
            onShow={onShowSubAgentsAndProcesses}
          />
        }
        reading={
          readOnlyReason === undefined && (
            <ContextReading look={threadReadingLook(thread, personName)} />
          )
        }
      />
      {readOnlyReason === undefined ? (
        <Composer
          placeholder={placeholder ?? writingPlaceholder(thread, personName)}
          busy={closed}
          busyHint="You write here while a Stage runs"
          prefilledNote={
            handoverNote && { text: handoverNote.text, writer: roleName(handoverNote.from, roles) }
          }
          startingDraft={startingDraft}
          autoFocus={autoFocus}
          openPage={openPage}
          onDrafting={onDrafting}
          onDraftChange={keepsDraft ? leaveDraft : undefined}
          onSend={(text, fromNote, uploadImages) =>
            sending.mutateAsync({
              message: {
                text,
                ...(fromNote && handoverNote ? { handoverNoteFrom: handoverNote.from } : {}),
                ...(openPage && mentionsOpenPage(text) && { openPage }),
              },
              uploadImages,
            })
          }
          onLeaveNoteOut={() => handoverNotes.clear(threadId)}
          // A Stage's session is the Pipeline's: "/" stays ordinary text there.
          {...(thread.stageThread
            ? {}
            : {
                skillCommands: thread.skillCommands,
                onOfficeCommand: commands.run,
                commandNote: commands.note,
                onCloseCommandNote: commands.closeNote,
              })}
        />
      ) : (
        <ReadOnlyNote reason={readOnlyReason} />
      )}
    </>
  );
}

interface SentMessage {
  readonly message: Omit<NewMessage, "images">;
  readonly uploadImages: UploadMessageImages;
}

type ShownCommandNote = "help" | "starts-fresh" | "nothing-to-clear";

/**
 * The Office commands of a Thread's message box (spec §2.4), carried out here and never sent: /clear
 * chooses Start fresh for the next message, where the context bar offers it, and /help lists the
 * commands. Each answers in a note above the composer, which isn't logged.
 */
function useOfficeCommands(thread: Thread): {
  readonly run: (name: OfficeCommandName) => void;
  readonly note: ReactNode;
  readonly closeNote: () => void;
  readonly error: Error | null;
} {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<ShownCommandNote>();
  const choosing = useMutation({
    mutationFn: () => chooseContextOverride(thread.id, "start-fresh"),
    onSuccess: (chosen) => {
      queryClient.setQueryData(threadQueries.one(chosen.id).queryKey, chosen);
      setShown("starts-fresh");
    },
  });
  const { context } = thread;
  const startsFreshOffered =
    context.override === "start-fresh" ||
    context.alternatives.some(({ override }) => override === "start-fresh");
  const run = (name: OfficeCommandName): void => {
    choosing.reset();
    if (name === "help") setShown("help");
    else if (startsFreshOffered) choosing.mutate();
    else setShown("nothing-to-clear");
  };
  const closeNote = (): void => setShown(undefined);
  const note = shown && (
    <CommandNote label={shown === "help" ? "Commands" : "Clear"} onClose={closeNote}>
      {shown === "help" ? (
        <CommandHelp skillCommands={thread.skillCommands} />
      ) : (
        clearWords(shown, thread)
      )}
    </CommandNote>
  );
  return { run, note, closeNote, error: choosing.error };
}

function clearWords(shown: "starts-fresh" | "nothing-to-clear", { context }: Thread): string {
  if (shown === "starts-fresh") return "Your next message starts a fresh session.";
  return context.reason === "new-thread"
    ? "There's no session to start fresh yet: your next message starts one."
    : "Your next message starts a fresh session already.";
}

/** Why nothing can be written, where a composer would be. */
export function ReadOnlyNote({ reason }: { readonly reason: string }): ReactNode {
  return (
    <p className="thread-read-only" role="note">
      <Icon name="lock" size={14} />
      {reason}
    </p>
  );
}
