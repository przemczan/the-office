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
  closeTab: ChatStore["closeTab"];
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
  const store = useChatStore();
  const place = useSyncExternalStore(store.subscribe, store.place);
  const { open, showThread, showThreadList, closeTab, close } = store;
  return { ...place, open, showThread, showThreadList, closeTab, close };
}

/**
 * The Proposal card the chat drawer was opened at. A card shown outside the shell's chat, as on
 * its own in a test, has none.
 */
export function useChatLandingProposal(): string | undefined {
  const store = useContext(ChatContext);
  return useSyncExternalStore(store?.subscribe ?? neverChanges, () => store?.place().proposalId);
}

const neverChanges = (): (() => void) => () => undefined;

function useChatStore(): ChatStore {
  const store = useContext(ChatContext);
  if (store === undefined) throw new Error("The chat needs the shell's provider.");
  return store;
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
