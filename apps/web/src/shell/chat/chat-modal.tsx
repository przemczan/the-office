import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Role, Thread } from "@the-office/contracts";
import { Avatar, Button, EmptyState, Icon, IconButton, useCloseOnEscape } from "@the-office/ui";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { startChatThread, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { ThreadView } from "../conversation/thread-view.tsx";
import { personName } from "../person-name.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { dayAndClockOf } from "../time.ts";
import { useChat } from "./use-chat.ts";
import "./chat.css";

/**
 * A person's chat, a modal over any page (spec §4, prototypes/app/chat.js): their Threads, the
 * one shown, and "New thread".
 */
export function ChatModal(): ReactNode {
  const chat = useChat();
  const role = useQuery({ ...roleQueries.one(chat.roleKey ?? ""), enabled: !!chat.roleKey });
  const frame = useRef<HTMLDivElement>(null);
  useCloseOnEscape(!!chat.roleKey && !!role.data, chat.close, frame);
  if (!chat.roleKey || !role.data) return null;
  // On the body, as a window is, so that it comes after the Needs you panel it opens over.
  return createPortal(
    <div className="chat-overlay">
      <div
        ref={frame}
        className="chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Chat with ${role.data.card.name}`}
      >
        <ChatHead role={role.data} onClose={chat.close} />
        <ChatBody role={role.data} />
      </div>
    </div>,
    document.body,
  );
}

function ChatHead({
  role,
  onClose,
}: {
  readonly role: Role;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <header className="chat-head">
      <Avatar name={role.card.name} size="md" />
      <div className="chat-head-name">
        <Link to="/people/$roleKey" params={{ roleKey: role.key }} search={{}}>
          {personName(role)}
        </Link>
        <div className="chat-head-sub">
          {/* The Caretaker's chat changes the workstation in a Thread with Allow changes on. */}
          {role.builtIn
            ? "Reads, and changes only in a Thread where you allow changes"
            : "Reads every Project and changes no file"}
        </div>
      </div>
      <IconButton icon={<Icon name="x" size={16} />} label="Close (Esc)" onClick={onClose} />
    </header>
  );
}

function ChatBody({ role }: { readonly role: Role }): ReactNode {
  const chat = useChat();
  const threads = useQuery(threadQueries.inChat(role.key));
  const queryClient = useQueryClient();
  const starting = useMutation({
    mutationFn: () => startChatThread(role.key),
    onSuccess: async (thread) => {
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await queryClient.invalidateQueries(threadQueries.inChat(role.key));
      chat.showThread(thread.id);
    },
  });
  const list = threads.data ?? [];
  const shown = list.find(({ id }) => id === chat.threadId) ?? list[0];
  const newThread = (
    <Button
      variant="secondary"
      iconLeft={<Icon name="plus" size={14} />}
      loading={starting.isPending}
      onClick={() => starting.mutate()}
    >
      New thread
    </Button>
  );
  return (
    <div className="chat-body">
      <aside className="chat-threads" aria-label="Threads">
        {newThread}
        <div className="chat-threads-count">Threads · {list.length}</div>
        {list.map((thread) => (
          <ThreadItem
            key={thread.id}
            thread={thread}
            active={thread.id === shown?.id}
            onOpen={() => chat.showThread(thread.id)}
          />
        ))}
      </aside>
      <div className="chat-main">
        {starting.error && <RefusalAlert title="No new Thread" error={starting.error} />}
        {shown ? (
          <ThreadView key={shown.id} threadId={shown.id} personName={role.card.name} />
        ) : (
          threads.data && (
            <EmptyState
              icon="message-circle"
              title={`No threads with ${role.card.name} yet.`}
              description="A new Thread starts a session that reads every Project's base branch."
              action={newThread}
            />
          )
        )}
      </div>
    </div>
  );
}

function ThreadItem({
  thread,
  active,
  onOpen,
}: {
  readonly thread: Thread;
  readonly active: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const warm = thread.context.cacheWarm;
  return (
    <button
      type="button"
      className={active ? "chat-thread active" : "chat-thread"}
      aria-current={active}
      onClick={onOpen}
    >
      <span className="chat-thread-title">{thread.title ?? "New thread"}</span>
      <span className="chat-thread-sub">
        <span
          className={warm ? "context-dot warm" : "context-dot"}
          title={warm ? "Cache warm" : "Starts fresh with a brief, or continues a small context"}
        />
        {dayAndClockOf(thread.startedAt)}
        {thread.state === "answering" && " · answering"}
      </span>
    </button>
  );
}
