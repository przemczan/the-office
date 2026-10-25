import { useNavigate, useSearch } from "@tanstack/react-router";

/** The chat open over the page, and opening, closing and moving between its Threads. */
export interface ChatControls {
  /** The person the chat is with, by their Role's key; undefined when no chat is open. */
  readonly roleKey: string | undefined;
  /** The Thread shown; undefined for the newest. */
  readonly threadId: string | undefined;
  open(roleKey: string, threadId?: string): void;
  showThread(threadId: string): void;
  close(): void;
}

/** The chat lives in the address (`?chat=planner&thread=…`), so it opens over any page. */
export function useChat(): ChatControls {
  const { chat, thread } = useSearch({ strict: false });
  const navigate = useNavigate();
  const go = (search: { chat?: string; thread?: string }): void =>
    void navigate({ to: ".", search: (current) => ({ ...current, ...search }) });
  return {
    roleKey: chat,
    threadId: thread,
    open: (roleKey, threadId) => go({ chat: roleKey, thread: threadId }),
    showThread: (threadId) => go({ thread: threadId }),
    close: () => go({ chat: undefined, thread: undefined }),
  };
}
