import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type NewMessage, type OpenPage, type Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useCallback, useState, type ReactNode } from "react";
import { sendMessage, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { AlarmNote } from "../fire-alarm/alarm-note.tsx";
import { OpenPageChip } from "../open-page-chip.tsx";
import { roleName } from "../person-name.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { SubAgentsAndProcessesLine } from "../sub-agents-and-processes/sub-agents-and-processes-line.tsx";
import { Composer } from "./composer.tsx";
import { ContextReading, SessionRow } from "./context-reading.tsx";
import { threadReadingLook } from "./context-reading-words.ts";
import { useHandoverNotes } from "./handover-notes.tsx";
import { useThreadDrafts } from "./thread-drafts.tsx";
import { takesMessages } from "./thread-writing.ts";

/**
 * Writing in a Thread: the composer with whatever waits to go in it, or why nothing more can be
 * written. A chat keys it by the Thread's id, as the composer owns the draft once it has read it;
 * the timeline doesn't, so its draft goes with the To line. A chat's Thread may have one waiting, and
 * a composer that `keepsDraft` leaves its own there, for when it comes back. Given the Open page, as
 * the chat drawer is, it shows the line that says the message goes with it, which the user can
 * leave out. Right above the message input, or the note saying why there is none, the line says
 * what Sub-agents and Processes the session runs (spec 2.9), and beside it, where a message can be
 * written, the context reading says how full the session's context is (spec §2.5).
 */
export function ThreadComposer({
  thread,
  personName,
  readOnlyReason,
  autoFocus = true,
  placeholder,
  keepsDraft = false,
  openPage,
  onLeaveOutOpenPage,
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
  /** The page open beside the chat drawer, which the next message goes with (spec §2.4). */
  readonly openPage?: OpenPage | undefined;
  /** Keeps the Open page out of messages; the chat drawer, which holds it, decides for how long. */
  readonly onLeaveOutOpenPage?: (() => void) | undefined;
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
    mutationFn: (message: NewMessage) => sendMessage(threadId, message),
    onSuccess: async (answering, { handoverNoteFrom }) => {
      if (handoverNoteFrom !== undefined) handoverNotes.clear(threadId);
      threadDrafts.clear(threadId);
      queryClient.setQueryData(threadQueries.one(answering.id).queryKey, answering);
      onSent?.(answering.id);
      await queryClient.invalidateQueries(threadQueries.messages(answering.id));
    },
  });
  const answering = thread.state === "answering";
  const stageRunning = answering && thread.stageThread;
  const closed = !takesMessages(thread);
  return (
    <>
      {sending.error && <RefusalAlert title="The message wasn't sent" error={sending.error} />}
      {readOnlyReason === undefined && !thread.stageThread && (
        // A Stage's session is held at its safe point instead.
        <AlarmNote threadId={threadId} personName={personName} />
      )}
      {readOnlyReason === undefined && openPage && onLeaveOutOpenPage && (
        <OpenPageLine page={openPage} onLeaveOut={onLeaveOutOpenPage} />
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
          placeholder={
            placeholder ??
            (stageRunning
              ? `Write to ${personName}… (lands at the next safe point)`
              : `Write to ${personName}…`)
          }
          busy={(answering && !stageRunning) || closed}
          busyHint={
            closed
              ? "You write here while a Stage runs"
              : `${personName} is still answering. Send it once they finish.`
          }
          prefilledNote={
            handoverNote && { text: handoverNote.text, writer: roleName(handoverNote.from, roles) }
          }
          startingDraft={startingDraft}
          autoFocus={autoFocus}
          onDrafting={onDrafting}
          onDraftChange={keepsDraft ? leaveDraft : undefined}
          onSend={(text, fromNote) =>
            sending.mutateAsync({
              text,
              ...(fromNote && handoverNote ? { handoverNoteFrom: handoverNote.from } : {}),
              ...(openPage && { openPage }),
            })
          }
          onLeaveNoteOut={() => handoverNotes.clear(threadId)}
        />
      ) : (
        <ReadOnlyNote reason={readOnlyReason} />
      )}
    </>
  );
}

/** The record the next message goes with, as the chat drawer's composer says it. */
function OpenPageLine({
  page,
  onLeaveOut,
}: {
  readonly page: OpenPage;
  readonly onLeaveOut: () => void;
}): ReactNode {
  return (
    <p className="composer-note composer-open-page" role="note">
      <Icon name="app-window" size={14} />
      <span className="composer-note-text">
        Open page: <OpenPageChip page={page} />
      </span>
      <Button size="sm" variant="secondary" onClick={onLeaveOut}>
        Leave out
      </Button>
    </p>
  );
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
