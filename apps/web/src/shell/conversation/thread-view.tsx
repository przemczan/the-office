import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenPage, Thread } from "@the-office/contracts";
import { Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  homeThreadsKey,
  renameThread,
  sendMessage,
  threadQueries,
} from "../../api/conversations.ts";
import { BlockLoaderOrProblem, type BlockRead } from "../block-loader.tsx";
import { InlineTitleEdit } from "../inline-title-edit.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { AllowChangesBar } from "./allow-changes.tsx";
import { ContextBar } from "./context-bar.tsx";
import { useDetails } from "./details-store.ts";
import { DetailsSwitch } from "./details-switch.tsx";
import type { LogLine } from "./message-groups.ts";
import { MessageList, type HandoverNoteReader, type SendAgain } from "./message-list.tsx";
import { ThreadComposer } from "./thread-composer.tsx";
import type { UserMessage } from "./stopped-messages.ts";
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
  openPage,
  headActions,
}: {
  readonly threadId: string;
  readonly personName: string;
  /** The way back from the Thread, before its title. */
  readonly back?: ReactNode;
  /** Why nothing more can be written here; the Thread stays readable and has no composer. */
  readonly readOnlyReason?: string | undefined;
  /** The page open beside it, which a message goes with when it mentions it. */
  readonly openPage?: OpenPage | undefined;
  /** Beside the Thread's title, such as the chat's trash icon. */
  readonly headActions?: ReactNode;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId));
  if (!thread.data) {
    return (
      <section className="thread-view">
        <ThreadLoader reads={[thread]} />
      </section>
    );
  }
  return (
    <section className="thread-view" aria-label={threadTitle(thread.data, personName)}>
      <div className="thread-view-head">
        {back}
        <ThreadTitle thread={thread.data} personName={personName} />
        {headActions}
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
        openPage={openPage}
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
  const queryClient = useQueryClient();
  const sendingAgain = useMutation({
    mutationFn: ({ text, images }: UserMessage) =>
      sendMessage(thread.id, {
        text,
        ...(images.length > 0 && { images: images.map(({ attachmentId }) => attachmentId) }),
      }),
    onSuccess: async (answering) => {
      queryClient.setQueryData(threadQueries.one(answering.id).queryKey, answering);
      await queryClient.invalidateQueries(threadQueries.messages(answering.id));
    },
  });
  const sendAgain: SendAgain = sendingAgain.mutateAsync;
  if (!messages.data) {
    return <ThreadLoader reads={[messages]} />;
  }
  return (
    <>
      {sendingAgain.error && (
        <RefusalAlert title="The message wasn't sent" error={sendingAgain.error} />
      )}
      <MessageList
        messages={messages.data}
        roleKey={thread.roleKey}
        personName={personName}
        answering={thread.state === "answering"}
        stageThread={thread.stageThread}
        details={details.on}
        inTimeline={inTimeline}
        leavesReaderBe={leavesReaderBe}
        handoverNoteReader={handoverNoteReader}
        onSendAgain={thread.stageThread ? undefined : sendAgain}
        {...(logLines && { logLines })}
      />
    </>
  );
}

/** A Thread's place until it and its messages first load: their turns, or the read's problem. */
export function ThreadLoader({ reads }: { readonly reads: readonly BlockRead[] }): ReactNode {
  return (
    <div className="thread-log-loading">
      <BlockLoaderOrProblem reads={reads} shape="turns" label="Loading the Thread…" />
    </div>
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
  const queryClient = useQueryClient();
  const renaming = useMutation({
    mutationFn: (title: string) => renameThread(thread.id, title),
    onSuccess: async (renamed) => {
      queryClient.setQueryData(threadQueries.one(renamed.id).queryKey, renamed);
      await queryClient.invalidateQueries({ queryKey: homeThreadsKey(renamed.home) });
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
                setEditing(true);
              }}
            />
          </span>
        )}
      </header>
    );
  }
  return (
    <InlineTitleEdit
      className="thread-title"
      label="Thread title"
      initial={thread.title ?? ""}
      saving={renaming.isPending}
      error={renaming.error}
      onSave={(given) => renaming.mutate(given)}
      onCancel={() => setEditing(false)}
    />
  );
}
