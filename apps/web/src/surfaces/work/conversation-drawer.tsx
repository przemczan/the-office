import { Button, Icon, IconButton, useCloseOnEscape } from "@the-office/ui";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { DecisionCardLinkContext } from "../../shell/conversation/decision-card.tsx";
import { useClosingShellPanels, usePagePanel } from "../../shell/side-panels.ts";
import { useNarrowPage } from "../../shell/use-narrow-page.ts";
import { drawerMoveOn, type DrawerAddress } from "./conversation-drawer-address.ts";
import { useConversationFit } from "./conversation-fit.ts";
import { newMessagesWords } from "./new-messages.ts";

const PANEL_ELEMENT_ID = "conversation-panel";
const HANDLE_ELEMENT_ID = "conversation-handle";
const FOCUSABLE =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']";

interface ConversationDrawer {
  /** The page is narrow enough for the conversation to be a drawer. */
  readonly narrow: boolean;
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
}

const ConversationDrawerContext = createContext<ConversationDrawer | undefined>(undefined);

/**
 * Holds the drawer open or closed for everything on a page that leads to the conversation or away
 * from it. Keyed by record, so it starts closed on the next one. One side panel at a time
 * (side-panels.ts): opening it closes the Needs you panel and Activity, and either of them or the
 * chat opening closes it; a chat drawer already open stays, under it.
 */
export function ConversationDrawerProvider({
  onLinkToDecisionCard,
  children,
}: {
  /** What else lies over a Decision's card and clears as a link leaves for it. */
  readonly onLinkToDecisionCard?: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const narrow = useNarrowPage();
  const [open, setOpen] = useState(false);
  const closeShellPanels = useClosingShellPanels();
  // Widened and narrowed again, the page must not come back dimmed.
  if (open && !narrow) setOpen(false);
  const value = useMemo(
    () => ({
      narrow,
      open,
      show: () => {
        // Only a drawer lies over the page; beside it the conversation leaves the panels be.
        if (narrow) closeShellPanels();
        setOpen(true);
      },
      close: () => setOpen(false),
    }),
    [narrow, open, closeShellPanels],
  );
  usePagePanel(open, value.close);
  return (
    <ConversationDrawerContext value={value}>
      <DecisionCardLinkContext
        value={() => {
          value.close();
          onLinkToDecisionCard?.();
        }}
      >
        {children}
      </DecisionCardLinkContext>
    </ConversationDrawerContext>
  );
}

export function useConversationDrawer(): ConversationDrawer {
  const drawer = useContext(ConversationDrawerContext);
  if (drawer === undefined) throw new Error("No ConversationDrawerProvider above this component");
  return drawer;
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
 * The conversation's panel. On a narrow page it is a drawer over the page, reached by a handle
 * with the unread count. The design system's Drawer can't serve: closed it unmounts its content,
 * and this one must keep the draft, the folds and the count, so closed it is only out of sight.
 * Pressing outside closes it, as it does a window (overlays.tsx), and never needs to ask: closed it
 * keeps its draft, so nothing is lost.
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
  useCloseOnEscape(open, close, panel, "side-panel");
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // React events bubble through portals, and a window opened from here keeps its own Tab.
    if (!open || !event.currentTarget.contains(event.target as Node)) return;
    if (event.key === "Tab") keepTabIn(event);
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
