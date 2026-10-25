import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Button, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { renameThread, sendMessage, threadQueries } from "../../api/conversations.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { Composer } from "./composer.tsx";
import { ContextBar } from "./context-bar.tsx";
import { MessageList } from "./message-list.tsx";
import "./conversation.css";

/** A Thread as its home shows it: its title, its context label, its log and the composer. */
export function ThreadView({
  threadId,
  personName,
}: {
  readonly threadId: string;
  readonly personName: string;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId));
  const messages = useQuery(threadQueries.messages(threadId));
  const queryClient = useQueryClient();
  const sending = useMutation({
    mutationFn: (text: string) => sendMessage(threadId, text),
    onSuccess: async (answering) => {
      queryClient.setQueryData(threadQueries.one(answering.id).queryKey, answering);
      await queryClient.invalidateQueries(threadQueries.messages(answering.id));
    },
  });
  if (!thread.data) return null;
  const answering = thread.data.state === "answering";
  return (
    <section className="thread-view" aria-label={thread.data.title ?? "New thread"}>
      <ThreadTitle thread={thread.data} />
      <ContextBar thread={thread.data} personName={personName} />
      <MessageList messages={messages.data ?? []} personName={personName} answering={answering} />
      {sending.error && <RefusalAlert title="The message wasn't sent" error={sending.error} />}
      <Composer
        placeholder={`Message ${personName}…`}
        busy={answering}
        busyHint={`${personName} is still answering`}
        onSend={(text) => sending.mutateAsync(text)}
      />
    </section>
  );
}

/** The Thread's title, renamed in place. */
function ThreadTitle({ thread }: { readonly thread: Thread }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title ?? "");
  const queryClient = useQueryClient();
  const renaming = useMutation({
    mutationFn: () => renameThread(thread.id, title),
    onSuccess: async (renamed) => {
      queryClient.setQueryData(threadQueries.one(renamed.id).queryKey, renamed);
      await queryClient.invalidateQueries({ queryKey: ["threads", "chat"] });
      setEditing(false);
    },
  });
  if (!editing) {
    return (
      <header className="thread-title">
        <h3>{thread.title ?? "New thread"}</h3>
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
