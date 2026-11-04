import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { NewMessage, Thread } from "@the-office/contracts";
import { Button, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  homeThreadsQuery,
  renameThread,
  sendMessage,
  threadQueries,
} from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { roleName } from "../person-name.ts";
import { AlarmNote } from "../fire-alarm/alarm-note.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { AllowChangesBar } from "./allow-changes.tsx";
import { Composer } from "./composer.tsx";
import { ContextBar } from "./context-bar.tsx";
import { useHandoverNotes } from "./handover-notes.tsx";
import { MessageList } from "./message-list.tsx";
import { useThreadDrafts } from "./thread-drafts.tsx";
import { threadTitle } from "./thread-title.ts";
import "./conversation.css";

/** A Thread as its home shows it: its title, its context label, its log and the composer. */
export function ThreadView({
  threadId,
  personName,
  readOnlyReason,
}: {
  readonly threadId: string;
  readonly personName: string;
  /** Why nothing more can be written here; the Thread stays readable and has no composer. */
  readonly readOnlyReason?: string;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId));
  const messages = useQuery(threadQueries.messages(threadId));
  const roles = useQuery(roleQueries.list()).data;
  const handoverNotes = useHandoverNotes();
  // Read once: the Thread's view is keyed by its id, and the composer owns the draft from then on.
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
      await queryClient.invalidateQueries(threadQueries.messages(answering.id));
    },
  });
  if (!thread.data) return null;
  const answering = thread.data.state === "answering";
  // While its Stage runs, a Stage Thread takes the user's message at the next safe point (barge-in);
  // between Stages The Office sends its messages, so it takes none from the user.
  const stageRunning = answering && thread.data.stageThread;
  const closed = thread.data.stageThread && !answering;
  return (
    <section className="thread-view" aria-label={threadTitle(thread.data, personName)}>
      <ThreadTitle thread={thread.data} personName={personName} />
      <ContextBar thread={thread.data} personName={personName} />
      {/* Only the Caretaker's chat has the switch. */}
      {thread.data.changesAllowed !== null && readOnlyReason === undefined && (
        <AllowChangesBar thread={thread.data} />
      )}
      {thread.data.consultation !== null && (
        <ConsultationNote askerRoleKey={thread.data.consultation.askerRoleKey} />
      )}
      <MessageList
        messages={messages.data ?? []}
        personName={personName}
        answering={answering}
        stageThread={thread.data.stageThread}
      />
      {sending.error && <RefusalAlert title="The message wasn't sent" error={sending.error} />}
      {readOnlyReason === undefined && !thread.data.stageThread && (
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
          onSend={(text, fromNote) =>
            sending.mutateAsync({
              text,
              ...(fromNote && handoverNote ? { handoverNoteFrom: handoverNote.from } : {}),
            })
          }
          onLeaveNoteOut={() => handoverNotes.clear(threadId)}
        />
      ) : (
        <p className="thread-read-only" role="note">
          <Icon name="lock" size={14} />
          {readOnlyReason}
        </p>
      )}
    </section>
  );
}

/**
 * What a Consultation is, for the user reading it live: they may write in it, or answer the
 * Decision in the Task's Needs you to take it over. The Office's own Decision, put to the CTO
 * first, holds the Task's Pipeline instead.
 */
function ConsultationNote({ askerRoleKey }: { readonly askerRoleKey: string | null }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const asker = roles?.find(({ key }) => key === askerRoleKey)?.card.name ?? askerRoleKey;
  return (
    <p className="thread-consultation" role="note">
      <Icon name="users" size={12} />
      {asker === null
        ? "The Office asks first here; the Task's Pipeline waits on this answer. Write here to join; answer the Decision in Needs you to take it over."
        : `${asker} waits on this answer. Write here to join; answer the Decision in Needs you to take it over.`}
    </p>
  );
}

/** The Thread's title, renamed in place. */
function ThreadTitle({
  thread,
  personName,
}: {
  readonly thread: Thread;
  readonly personName: string;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title ?? "");
  const queryClient = useQueryClient();
  const renaming = useMutation({
    mutationFn: () => renameThread(thread.id, title),
    onSuccess: async (renamed) => {
      queryClient.setQueryData(threadQueries.one(renamed.id).queryKey, renamed);
      await queryClient.invalidateQueries({ queryKey: homeThreadsKey(renamed) });
      setEditing(false);
    },
  });
  if (!editing) {
    return (
      <header className="thread-title">
        <h3>{threadTitle(thread, personName)}</h3>
        {thread.title !== null && (
          <IconButton
            icon={<Icon name="pencil" size={14} />}
            label="Rename the Thread"
            size="sm"
            onClick={() => {
              setTitle(thread.title ?? "");
              setEditing(true);
            }}
          />
        )}
      </header>
    );
  }
  return (
    <form
      className="thread-title"
      onSubmit={(event) => {
        event.preventDefault();
        renaming.mutate();
      }}
    >
      <Input
        aria-label="Thread title"
        size="sm"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        autoFocus
      />
      <Button size="sm" type="submit" loading={renaming.isPending}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {renaming.error && <RefusalAlert title="The title wasn't saved" error={renaming.error} />}
    </form>
  );
}

/** The list of the Thread's home, which shows its title too. */
function homeThreadsKey({ home }: Thread): QueryKey {
  return homeThreadsQuery(home).queryKey;
}
