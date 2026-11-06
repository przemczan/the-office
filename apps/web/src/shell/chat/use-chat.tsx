import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createChatStore, tabStorage, type ChatPlace, type ChatStore } from "./chat-store.ts";

/** The chat drawer, and opening, closing and moving inside it. */
export interface ChatControls extends ChatPlace {
  open: ChatStore["open"];
  showThread: ChatStore["showThread"];
  showThreadList: ChatStore["showThreadList"];
  close: ChatStore["close"];
}

const ChatContext = createContext<ChatStore | undefined>(undefined);

/**
 * Holds the chat in the shell, out of the address, so no link closes it and Back and Forward leave
 * it be. An address with `?chat=…&thread=…`, such as a Notification's or an old link, is a way in.
 */
export function ChatProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [store] = useState(() => createChatStore(tabStorage()));
  useOpeningFromTheAddress(store);
  return <ChatContext value={store}>{children}</ChatContext>;
}

export function useChat(): ChatControls {
  const store = useContext(ChatContext);
  if (store === undefined) throw new Error("useChat needs the shell's provider.");
  const place = useSyncExternalStore(store.subscribe, store.place);
  const { open, showThread, showThreadList, close } = store;
  return { ...place, open, showThread, showThreadList, close };
}

function useOpeningFromTheAddress(store: ChatStore): void {
  const { chat, thread } = useSearch({ strict: false });
  const navigate = useNavigate();
  useEffect(() => {
    if (chat === undefined && thread === undefined) return;
    if (chat !== undefined) store.open(chat, thread);
    void navigate({
      to: ".",
      search: (current) => ({ ...current, chat: undefined, thread: undefined }),
      hash: true,
      replace: true,
      resetScroll: false,
    });
  }, [chat, thread, store, navigate]);
}
