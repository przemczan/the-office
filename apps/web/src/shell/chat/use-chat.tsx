import { useNavigate, useSearch } from "@tanstack/react-router";
import { sameOpenPage, type OpenPage } from "@the-office/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createChatStore, tabStorage, type ChatPlace, type ChatStore } from "./chat-store.ts";
import { useOpenPage } from "./open-page.ts";

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
  useFollowingTheOpenPage(store);
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

/** What the chat drawer's next message goes with, and leaving it out (spec §2.4). */
export interface ChatOpenPage {
  /** The Open page, or undefined on a page with none or once the user left it out. */
  readonly page: OpenPage | undefined;
  readonly leaveOut: () => void;
}

export function useChatOpenPage(): ChatOpenPage {
  const store = useChatStore();
  const openPage = useOpenPage();
  const leftOut = useSyncExternalStore(store.subscribe, store.leftOutPage);
  const page = openPage && !(leftOut && sameOpenPage(leftOut, openPage)) ? openPage : undefined;
  return {
    page,
    leaveOut: () => {
      if (page) store.leaveOut(page);
    },
  };
}

function useChatStore(): ChatStore {
  const store = useContext(ChatContext);
  if (store === undefined) throw new Error("The chat needs the shell's provider.");
  return store;
}

/**
 * Kept in the provider, which stays mounted while the drawer closes or its Threads change, so only
 * another page brings a left-out page's line back, and coming back to it shows the line again.
 */
function useFollowingTheOpenPage(store: ChatStore): void {
  const openPage = useOpenPage();
  useEffect(() => store.openPageChanged(openPage), [store, openPage]);
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
