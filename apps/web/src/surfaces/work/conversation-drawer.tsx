import { Button, Icon, IconButton } from "@the-office/ui";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { DecisionCardLinkContext } from "../../shell/conversation/decision-card.tsx";
import { drawerMoveOn, type DrawerAddress } from "./conversation-drawer-address.ts";
import { useConversationFit } from "./conversation-fit.ts";
import { newMessagesWords } from "./new-messages.ts";
import { bringChapterIntoView } from "./use-timeline-scroll.ts";

const DRAWER_WINDOW_WIDTH_PX = 900;
const NARROW_WINDOW_QUERY = `(max-width: ${DRAWER_WINDOW_WIDTH_PX}px)`;
const PANEL_ELEMENT_ID = "conversation-panel";
const HANDLE_ELEMENT_ID = "conversation-handle";
const FOCUSABLE =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']";

interface ConversationDrawer {
  /** The window is narrow enough for the conversation to be a drawer. */
  readonly narrow: boolean;
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
}

const ConversationDrawerContext = createContext<ConversationDrawer | undefined>(undefined);

/**
 * Holds the drawer open or closed for everything on a page that leads to the conversation or away
 * from it. Keyed by record, so it starts closed on the next one.
 */
export function ConversationDrawerProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const narrow = useNarrowWindow();
  const [open, setOpen] = useState(false);
  // Widened and narrowed again, the window must not come back dimmed.
  if (open && !narrow) setOpen(false);
  const value = useMemo(
    () => ({ narrow, open, show: () => setOpen(true), close: () => setOpen(false) }),
    [narrow, open],
  );
  return (
    <ConversationDrawerContext value={value}>
      <DecisionCardLinkContext value={value.close}>{children}</DecisionCardLinkContext>
    </ConversationDrawerContext>
  );
}

export function useConversationDrawer(): ConversationDrawer {
  const drawer = useContext(ConversationDrawerContext);
  if (drawer === undefined) throw new Error("No ConversationDrawerProvider above this component");
  return drawer;
}

/** For a link the user follows to a Thread: followed again it changes no address. */
export function useBringThreadIntoView(): (threadId: string) => void {
  const { show } = useConversationDrawer();
  return (threadId) => {
    show();
    bringChapterIntoView(threadId);
  };
}

/** Moves the drawer for what the address gains; `address` is undefined until it can be judged. */
export function useDrawerFollowsAddress(address: DrawerAddress | undefined): void {
  const { show, close } = useConversationDrawer();
  const seen = useRef<DrawerAddress>(undefined);
  useEffect(() => {
    if (address === undefined) return;
    const move = drawerMoveOn(seen.current, address);
    seen.current = address;
    if (move === "open") show();
    else if (move === "close") close();
  });
}

/**
 * The conversation's panel. In a narrow window it is a drawer over the page, reached by a handle
 * with the unread count. The design system's Drawer can't serve: closed it unmounts its content,
 * and this one must keep the draft, the folds and the count, so closed it is only out of sight.
 * Pressing outside closes it, unlike a window (overlays.tsx): it is a side view, losing nothing.
 */
export function ConversationPanel({
  unread,
  children,
}: {
  readonly unread: number;
  readonly children: ReactNode;
}): ReactNode {
  const { narrow, open, show, close } = useConversationDrawer();
  const panel = useConversationFit();
  useDrawerFocus(open, panel);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // React events bubble through portals, and the Attachment viewer has its own Esc.
    if (!open || !event.currentTarget.contains(event.target as Node)) return;
    if (event.key === "Escape") close();
    else if (event.key === "Tab") keepTabIn(event);
  };
  const panelClass = `task-conversation${narrow ? " conversation-drawer" : ""}${open ? " open" : ""}`;
  return (
    <>
      {narrow && (
        <>
          <Button
            id={HANDLE_ELEMENT_ID}
            className="conversation-handle"
            size="lg"
            style={{ borderRadius: "var(--radius-full)", boxShadow: "var(--shadow-3)" }}
            iconLeft={<Icon name="message-circle" size={14} />}
            aria-expanded={open}
            aria-controls={PANEL_ELEMENT_ID}
            onClick={show}
          >
            Conversation
            {unread > 0 && (
              <span className="conversation-unread">
                <span aria-hidden="true">{unread}</span>
                <span className="visually-hidden"> {newMessagesWords(unread)}</span>
              </span>
            )}
          </Button>
          <div
            className={`conversation-scrim${open ? " open" : ""}`}
            role="presentation"
            onClick={close}
          />
        </>
      )}
      <aside
        ref={panel}
        id={PANEL_ELEMENT_ID}
        className={panelClass}
        aria-label="Conversation"
        tabIndex={narrow ? -1 : undefined}
        onKeyDown={onKeyDown}
      >
        {children}
      </aside>
    </>
  );
}

/** Beside the conversation's heading, for as long as it is a drawer. */
export function CloseConversation(): ReactNode {
  const { narrow, close } = useConversationDrawer();
  if (!narrow) return null;
  return (
    <IconButton
      icon={<Icon name="x" size={14} />}
      label="Close the conversation"
      size="xs"
      onClick={close}
    />
  );
}

function useNarrowWindow(): boolean {
  return useSyncExternalStore(subscribeToWindowWidth, windowIsNarrow);
}

function subscribeToWindowWidth(changed: () => void): () => void {
  const query = window.matchMedia(NARROW_WINDOW_QUERY);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

function windowIsNarrow(): boolean {
  return window.matchMedia(NARROW_WINDOW_QUERY).matches;
}

/**
 * Opening moves focus into the panel. Closing gives it back to the handle, unless what closed the
 * drawer has already taken it elsewhere, as a chapter's way to the rail does.
 */
function useDrawerFocus(open: boolean, panel: RefObject<HTMLElement | null>): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) {
      panel.current?.focus();
      return;
    }
    const focused = document.activeElement;
    if (focused === document.body || panel.current?.contains(focused) === true) {
      document.getElementById(HANDLE_ELEMENT_ID)?.focus();
    }
  }, [open, panel]);
}

/** The design system has no focus trap, and the page behind the scrim is out of reach. */
function keepTabIn(event: KeyboardEvent<HTMLElement>): void {
  const panel = event.currentTarget;
  const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return;
  const focused = document.activeElement;
  const wraps = event.shiftKey ? focused === first || focused === panel : focused === last;
  if (!wraps) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
