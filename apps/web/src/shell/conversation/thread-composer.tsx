import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sameOpenPage, type NewMessage, type OpenPage, type Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useCallback, useState, type ReactNode } from "react";
import { sendMessage, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { AlarmNote } from "../fire-alarm/alarm-note.tsx";
import { OpenPageChip } from "../open-page-chip.tsx";
import { roleName } from "../person-name.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { Composer } from "./composer.tsx";
import { useHandoverNotes } from "./handover-notes.tsx";
import { useThreadDrafts } from "./thread-drafts.tsx";
import { takesMessages } from "./thread-writing.ts";

/**
 * Writing in a Thread: the composer with whatever waits to go in it, or why nothing more can be
 * written. A chat keys it by the Thread's id, as the composer owns the draft once it has read it;
 * the timeline doesn't, so its draft goes with the To line. A chat's Thread may have one waiting, and
 * a composer that `keepsDraft` leaves its own there, for when it comes back. Given the Open page, as
 * the chat drawer is, it shows the line that says the message goes with it, which the user can
 * leave out of that message.
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
  readonly onDrafting?: (drafting: boolean) => void;
  readonly onSent?: (threadId: string) => void;
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
  // Left out of the next message only: a page navigated to after shows again.
  const [leftOut, setLeftOut] = useState<OpenPage | undefined>();
  const sentWith = openPage && !(leftOut && sameOpenPage(leftOut, openPage)) ? openPage : undefined;
  const queryClient = useQueryClient();
  const sending = useMutation({
    mutationFn: (message: NewMessage) => sendMessage(threadId, message),
    onSuccess: async (answering, { handoverNoteFrom }) => {
      if (handoverNoteFrom !== undefined) handoverNotes.clear(threadId);
      setLeftOut(undefined);
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
      {readOnlyReason === undefined && sentWith && (
        <OpenPageLine page={sentWith} onLeaveOut={() => setLeftOut(sentWith)} />
      )}
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
              ...(sentWith && { openPage: sentWith }),
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
