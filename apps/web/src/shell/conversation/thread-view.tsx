import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Button, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { homeThreadsQuery, renameThread, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { AllowChangesBar } from "./allow-changes.tsx";
import { ContextBar } from "./context-bar.tsx";
import { useDetails } from "./details-store.ts";
import { DetailsSwitch } from "./details-switch.tsx";
import { MessageList } from "./message-list.tsx";
import { ThreadComposer } from "./thread-composer.tsx";
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
  readonly readOnlyReason?: string | undefined;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId));
  if (!thread.data) return null;
  return (
    <section className="thread-view" aria-label={threadTitle(thread.data, personName)}>
      <div className="thread-view-head">
        <ThreadTitle thread={thread.data} personName={personName} />
        <DetailsSwitch />
      </div>
      <ContextBar thread={thread.data} personName={personName} />
      {/* Only the Caretaker's chat has the switch. */}
      {thread.data.changesAllowed !== null && readOnlyReason === undefined && (
        <AllowChangesBar thread={thread.data} />
      )}
      <ThreadLog thread={thread.data} personName={personName} />
      <ThreadComposer
        key={threadId}
        thread={thread.data}
        personName={personName}
        readOnlyReason={readOnlyReason}
      />
    </section>
  );
}

/** What was said in a Thread, under a Consultation's note. */
export function ThreadLog({
  thread,
  personName,
  inTimeline = false,
}: {
  readonly thread: Thread;
  readonly personName: string;
  /** The log is a chapter of a timeline, which does the scrolling. */
  readonly inTimeline?: boolean;
}): ReactNode {
  const messages = useQuery(threadQueries.messages(thread.id));
  const details = useDetails();
  return (
    <>
      {thread.consultation !== null && (
        <ConsultationNote askerRoleKey={thread.consultation.askerRoleKey} />
      )}
      <MessageList
        messages={messages.data ?? []}
        personName={personName}
        answering={thread.state === "answering"}
        stageThread={thread.stageThread}
        details={details.on}
        inTimeline={inTimeline}
      />
    </>
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
        ? "The Office asks first here; the Task's Pipeline waits on this answer. Choose this Thread in To to join; answer the Decision in Needs you to take it over."
        : `${asker} waits on this answer. Choose this Thread in To to join; answer the Decision in Needs you to take it over.`}
    </p>
  );
}

/** The Thread's title, renamed in place. `children` read as the title instead, as a chapter's toggle. */
export function ThreadTitle({
  thread,
  personName,
  children,
}: {
  readonly thread: Thread;
  readonly personName: string;
  readonly children?: ReactNode;
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
        {children ?? <h3>{threadTitle(thread, personName)}</h3>}
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
