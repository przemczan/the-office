import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NewMessage, Thread } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { sendMessage, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { AlarmNote } from "../fire-alarm/alarm-note.tsx";
import { roleName } from "../person-name.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { Composer } from "./composer.tsx";
import { useHandoverNotes } from "./handover-notes.tsx";
import { useThreadDrafts } from "./thread-drafts.tsx";
import { takesMessages } from "./thread-writing.ts";

/**
 * Writing in a Thread: the composer with whatever waits to go in it, or why nothing more can be
 * written. A chat keys it by the Thread's id, as the composer owns the draft once it has read it;
 * the timeline doesn't, so its draft goes with the To line. Only chats' Threads have one waiting.
 */
export function ThreadComposer({
  thread,
  personName,
  readOnlyReason,
  autoFocus = true,
  onDrafting,
  onSent,
}: {
  readonly thread: Thread;
  readonly personName: string;
  /** Why nothing more can be written here; the Thread stays readable and has no composer. */
  readonly readOnlyReason?: string | undefined;
  /** Focus scrolls the page, so a composer that isn't the page's whole point leaves it out. */
  readonly autoFocus?: boolean;
  readonly onDrafting?: (drafting: boolean) => void;
  readonly onSent?: (threadId: string) => void;
}): ReactNode {
  const threadId = thread.id;
  const roles = useQuery(roleQueries.list()).data;
  const handoverNotes = useHandoverNotes();
  const [handoverNote] = useState(() => handoverNotes.waitingIn(threadId));
  const threadDrafts = useThreadDrafts();
  const [startingDraft] = useState(() => threadDrafts.waitingIn(threadId));
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
      {readOnlyReason === undefined ? (
        <Composer
          placeholder={
            stageRunning
              ? `Message ${personName}… (lands at the next safe point)`
              : `Message ${personName}…`
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
          onSend={(text, fromNote) =>
            sending.mutateAsync({
              text,
              ...(fromNote && handoverNote ? { handoverNoteFrom: handoverNote.from } : {}),
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

/** Why nothing can be written, where a composer would be. */
export function ReadOnlyNote({ reason }: { readonly reason: string }): ReactNode {
  return (
    <p className="thread-read-only" role="note">
      <Icon name="lock" size={14} />
      {reason}
    </p>
  );
}
