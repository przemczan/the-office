import { sameOpenPage, type OpenPage } from "@the-office/contracts";

/** Whether the chat drawer is open, and on what. Closed, it remembers where the user left off. */
export interface ChatPlace {
  readonly isOpen: boolean;
  /** The person, by their Role's key; undefined until one is picked. */
  readonly roleKey: string | undefined;
  /** The Thread shown; undefined for the person's newest. */
  readonly threadId: string | undefined;
  /** The user stepped back to the person's Thread list. */
  readonly onThreadList: boolean;
}

/** Per browser tab, so a reload keeps the drawer and another tab has its own. */
export const CHAT_STORAGE_KEY = "the-office.chat";

const CLOSED: ChatPlace = {
  isOpen: false,
  roleKey: undefined,
  threadId: undefined,
  onThreadList: false,
};

/** The chat's place, in the shape React's `useSyncExternalStore` reads. */
export interface ChatStore {
  place(): ChatPlace;
  /** Opens on the person, or where the user left off when none is named. */
  open(roleKey?: string, threadId?: string): void;
  showThread(threadId: string): void;
  showThreadList(): void;
  close(): void;
  /** The Open page the user left out, kept out of messages while it stays open (spec §2.4). */
  leftOutPage(): OpenPage | undefined;
  leaveOut(page: OpenPage): void;
  /** The page open beside the drawer now; another one than the left-out page brings its line back. */
  openPageChanged(page: OpenPage | undefined): void;
  subscribe(onChange: () => void): () => void;
}

/** This browser tab's storage; none where reaching it is blocked, for a place lasting the page. */
export function tabStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

/** Kept in `storage`, or for this page alone where storage is blocked. */
export function createChatStore(storage: Pick<Storage, "getItem" | "setItem">): ChatStore {
  let place = storedPlace(storage);
  // Lasts the page only: the page open after a reload is looked at afresh.
  let leftOut: OpenPage | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const update = (changes: Partial<ChatPlace>): void => {
    place = { ...place, ...changes };
    try {
      storage.setItem(CHAT_STORAGE_KEY, JSON.stringify(place));
    } catch {
      // Storage is blocked: a reload closes the drawer.
    }
    notify();
  };

  return {
    place: () => place,
    open: (roleKey, threadId) =>
      update(
        roleKey === undefined
          ? { isOpen: true }
          : { isOpen: true, roleKey, threadId, onThreadList: false },
      ),
    showThread: (threadId) => update({ threadId, onThreadList: false }),
    showThreadList: () => update({ onThreadList: true }),
    close: () => update({ isOpen: false }),
    leftOutPage: () => leftOut,
    leaveOut: (page) => {
      leftOut = page;
      notify();
    },
    openPageChanged: (page) => {
      if (leftOut === undefined || (page !== undefined && sameOpenPage(leftOut, page))) return;
      leftOut = undefined;
      notify();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

function storedPlace(storage: Pick<Storage, "getItem">): ChatPlace {
  try {
    const stored: unknown = JSON.parse(storage.getItem(CHAT_STORAGE_KEY) ?? "null");
    return isChatPlace(stored) ? stored : CLOSED;
  } catch {
    return CLOSED;
  }
}

function isChatPlace(stored: unknown): stored is ChatPlace {
  if (typeof stored !== "object" || stored === null) return false;
  const { isOpen, roleKey, threadId, onThreadList } = stored as Record<string, unknown>;
  return (
    typeof isOpen === "boolean" &&
    typeof onThreadList === "boolean" &&
    (roleKey === undefined || typeof roleKey === "string") &&
    (threadId === undefined || typeof threadId === "string")
  );
}
