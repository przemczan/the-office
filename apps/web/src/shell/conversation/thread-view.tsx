import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Button, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { homeThreadsQuery, renameThread, threadQueries } from "../../api/conversations.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { AllowChangesBar } from "./allow-changes.tsx";
import { ContextBar } from "./context-bar.tsx";
import { useDetails } from "./details-store.ts";
import { DetailsSwitch } from "./details-switch.tsx";
import type { LogLine } from "./message-groups.ts";
import { MessageList, type HandoverNoteReader } from "./message-list.tsx";
import { ThreadComposer } from "./thread-composer.tsx";
import { threadTitle } from "./thread-title.ts";
import "./conversation.css";

/**
 * A Thread as its home shows it: its title, its context label, its log and the composer, which keeps
 * a draft while the Thread is out of sight.
 */
export function ThreadView({
  threadId,
  personName,
  back,
  readOnlyReason,
}: {
  readonly threadId: string;
  readonly personName: string;
  /** The way back from the Thread, before its title. */
  readonly back?: ReactNode;
  /** Why nothing more can be written here; the Thread stays readable and has no composer. */
  readonly readOnlyReason?: string | undefined;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId));
  if (!thread.data) return null;
  return (
    <section className="thread-view" aria-label={threadTitle(thread.data, personName)}>
      <div className="thread-view-head">
        {back}
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
        keepsDraft
      />
    </section>
  );
}

/** What was said in a Thread. */
export function ThreadLog({
  thread,
  personName,
  inTimeline = false,
  leavesReaderBe = false,
  logLines,
  handoverNoteReader,
}: {
  readonly thread: Thread;
  readonly personName: string;
  /** The log is a chapter of a timeline, which does the scrolling. */
  readonly inTimeline?: boolean;
  /** A reader who scrolled up stays there as the log grows. */
  readonly leavesReaderBe?: boolean;
  /** What isn't a message but belongs in the log by its time. */
  readonly logLines?: readonly LogLine[];
  /** Where a Handover note reads whole, when not here. */
  readonly handoverNoteReader?: HandoverNoteReader;
}): ReactNode {
  const messages = useQuery(threadQueries.messages(thread.id));
  const details = useDetails();
  return (
    <>
      <MessageList
        messages={messages.data ?? []}
        personName={personName}
        answering={thread.state === "answering"}
        stageThread={thread.stageThread}
        details={details.on}
        inTimeline={inTimeline}
        leavesReaderBe={leavesReaderBe}
        handoverNoteReader={handoverNoteReader}
        {...(logLines && { logLines })}
      />
    </>
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
          <span className="thread-rename">
            <IconButton
              icon={<Icon name="pencil" size={14} />}
              label="Rename the Thread"
              size="sm"
              onClick={() => {
                setTitle(thread.title ?? "");
                setEditing(true);
              }}
            />
          </span>
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
