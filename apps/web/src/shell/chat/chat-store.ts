import { sameOpenPage, type OpenPage } from "@the-office/contracts";

/** A person open in the drawer, and where the user left off with them. */
export interface ChatTab {
  /** The person, by their Role's key. */
  readonly roleKey: string;
  /** The Thread shown; undefined for the person's newest. */
  readonly threadId: string | undefined;
  /** The user stepped back to the person's Thread list. */
  readonly onThreadList: boolean;
}

/** Whether the chat drawer is open, and on what. Closed, it remembers where the user left off. */
export interface ChatPlace {
  readonly isOpen: boolean;
  /** The person shown, by their Role's key; undefined until one is picked or once every tab closes. */
  readonly roleKey: string | undefined;
  /** The shown person's Thread; undefined for their newest. */
  readonly threadId: string | undefined;
  /** The user stepped back to the shown person's Thread list. */
  readonly onThreadList: boolean;
  /** Every person open in the drawer, in the order they were opened. */
  readonly tabs: readonly ChatTab[];
}

/** Per browser tab, so a reload keeps the drawer and another tab has its own. */
export const CHAT_STORAGE_KEY = "the-office.chat";

/** What is kept: the shown tab's Thread is read from the tab itself. */
interface StoredPlace {
  readonly isOpen: boolean;
  readonly roleKey: string | undefined;
  readonly tabs: readonly ChatTab[];
}

const CLOSED: StoredPlace = { isOpen: false, roleKey: undefined, tabs: [] };

/** The chat's place, in the shape React's `useSyncExternalStore` reads. */
export interface ChatStore {
  place(): ChatPlace;
  /**
   * Opens on the person, adding their tab if it isn't open; a tab already open keeps where the user
   * left off unless a Thread is named. With no person named, opens where the user left off.
   */
  open(roleKey?: string, threadId?: string): void;
  showThread(threadId: string): void;
  showThreadList(): void;
  /** Closing the tab shown shows its neighbour, the one on its right first; the last leaves the person picker. */
  closeTab(roleKey: string): void;
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
  let stored = storedPlace(storage);
  let place = placeOf(stored);
  // Lasts the page only: the page open after a reload is looked at afresh.
  let leftOut: OpenPage | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const update = (changes: Partial<StoredPlace>): void => {
    stored = { ...stored, ...changes };
    place = placeOf(stored);
    try {
      storage.setItem(CHAT_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage is blocked: a reload closes the drawer.
    }
    notify();
  };

  const updateShownTab = (changes: Partial<Omit<ChatTab, "roleKey">>): void => {
    const { roleKey, tabs } = stored;
    update({
      tabs: tabs.map((tab) => (tab.roleKey === roleKey ? { ...tab, ...changes } : tab)),
    });
  };

  return {
    place: () => place,
    open: (roleKey, threadId) =>
      update(
        roleKey === undefined
          ? { isOpen: true }
          : { isOpen: true, roleKey, tabs: withTabOpen(stored.tabs, roleKey, threadId) },
      ),
    showThread: (threadId) => updateShownTab({ threadId, onThreadList: false }),
    showThreadList: () => updateShownTab({ onThreadList: true }),
    closeTab: (roleKey) => {
      const { tabs } = stored;
      const closing = tabs.findIndex((tab) => tab.roleKey === roleKey);
      if (closing === -1) return;
      const left = tabs.filter((_, index) => index !== closing);
      update({
        tabs: left,
        roleKey:
          roleKey === stored.roleKey
            ? (left[closing] ?? left[closing - 1])?.roleKey
            : stored.roleKey,
      });
    },
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

function withTabOpen(
  tabs: readonly ChatTab[],
  roleKey: string,
  threadId: string | undefined,
): readonly ChatTab[] {
  if (!tabs.some((tab) => tab.roleKey === roleKey)) {
    return [...tabs, { roleKey, threadId, onThreadList: false }];
  }
  if (threadId === undefined) return tabs;
  return tabs.map((tab) => (tab.roleKey === roleKey ? { roleKey, threadId, onThreadList: false } : tab));
}

function placeOf({ isOpen, roleKey, tabs }: StoredPlace): ChatPlace {
  const shown = tabs.find((tab) => tab.roleKey === roleKey);
  return {
    isOpen,
    roleKey: shown?.roleKey,
    threadId: shown?.threadId,
    onThreadList: shown?.onThreadList ?? false,
    tabs,
  };
}

function storedPlace(storage: Pick<Storage, "getItem">): StoredPlace {
  try {
    const stored: unknown = JSON.parse(storage.getItem(CHAT_STORAGE_KEY) ?? "null");
    if (isStoredPlace(stored)) return stored;
    return placeBeforeTabs(stored) ?? CLOSED;
  } catch {
    return CLOSED;
  }
}

function isStoredPlace(stored: unknown): stored is StoredPlace {
  if (typeof stored !== "object" || stored === null) return false;
  const { isOpen, roleKey, tabs } = stored as Record<string, unknown>;
  return (
    typeof isOpen === "boolean" &&
    (roleKey === undefined || typeof roleKey === "string") &&
    Array.isArray(tabs) &&
    tabs.every(isChatTab)
  );
}

function isChatTab(stored: unknown): stored is ChatTab {
  if (typeof stored !== "object" || stored === null) return false;
  const { roleKey, threadId, onThreadList } = stored as Record<string, unknown>;
  return (
    typeof roleKey === "string" &&
    typeof onThreadList === "boolean" &&
    (threadId === undefined || typeof threadId === "string")
  );
}

/** A place kept before the tabs: its one person becomes their tab, so a reload keeps the chat. */
function placeBeforeTabs(stored: unknown): StoredPlace | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const { isOpen, roleKey, threadId, onThreadList } = stored as Record<string, unknown>;
  if (typeof isOpen !== "boolean") return undefined;
  if (roleKey === undefined) return { isOpen, roleKey, tabs: [] };
  const tab = { roleKey, threadId, onThreadList };
  return isChatTab(tab) ? { isOpen, roleKey: tab.roleKey, tabs: [tab] } : undefined;
}
