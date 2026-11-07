// `Dialog` is the window of docs/spec/4.1-ui-rules.md#windows: three sizes and one frame, closed only
// by Escape, its X or its Close button. The design system's Drawer closes on a press on its dimmed
// backdrop, so a press landing on the backdrop itself is stopped before its handler sees it.
// design-system/ stays as exported, hence the wrapper rather than an edit there. The conversation's
// drawer on the Task and Initiative pages is the exception, closing on a press outside: a side view
// with its draft kept, not a window, and built apart from these
// (apps/web/src/surfaces/work/conversation-drawer.tsx). `Tooltip` is built here too: the design
// system's sits inside its trigger, where anything clipping or stacking around it covers it. One press
// of Escape closes one thing: a menu first, then a window, then the side panel opened last (the chat
// drawer, the Needs you panel, the conversation's drawer), by the order in `openSidePanels`.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../design-system/components/core/Button.jsx";
import { Icon } from "../../../design-system/components/core/Icon.jsx";
import { IconButton } from "../../../design-system/components/core/IconButton.jsx";
import {
  Drawer as DesignSystemDrawer,
  type DrawerProps,
} from "../../../design-system/components/overlays/Drawer.jsx";
import {
  tooltipPlace,
  TOOLTIP_WINDOW_MARGIN_PX,
  type TooltipPlace,
  type TooltipSide,
} from "./tooltip-place.ts";

/** A step before an action, opened over the bar: its confirming action and Cancel replace the bar's actions. */
export interface DialogStep {
  readonly content: ReactNode;
  /** The step's confirming action; the frame adds Cancel after it. */
  readonly actions: ReactNode;
  readonly onCancel: () => void;
}

interface DialogContentProps {
  readonly open?: boolean;
  /** What the window is: its title, or its badge and whose it is. */
  readonly title: ReactNode;
  readonly children?: ReactNode;
  /** The bar's actions, on the left: the main one first, a destructive one last. Close is added on the right. */
  readonly actions?: ReactNode;
  readonly step?: DialogStep;
  readonly onClose: () => void;
}

/** A confirmation (small), a form (medium), or something to read or look at (large). */
export type DialogSize = "small" | "medium" | "large";

type DialogSizeProps =
  | { readonly size: "small"; readonly keepsHeight?: never }
  | {
      readonly size: "medium" | "large";
      /**
       * For a window whose content changes as the user moves inside it, so it doesn't jump: 640px
       * high when medium, 86% of the browser window when large, less when the browser is shorter.
       */
      readonly keepsHeight?: boolean;
    };

export type DialogProps = DialogContentProps & DialogSizeProps;

export function Drawer(props: DrawerProps): ReactNode {
  const { open = true, inline = false, onClose } = props;
  const frame = useRef<HTMLDivElement>(null);
  useCloseOnEscape(open && !inline && !!onClose, onClose ?? closeNothing, frame, "side-panel");
  // Its own Escape listens on `window`, as a menu's does, so a press meant for a menu reaches it too.
  const closeUnlessForAMenu = (): void => {
    if (!menuIsOpen()) onClose?.();
  };
  return (
    <KeepOpenOnBackdropPress ref={frame} inline={inline}>
      <DesignSystemDrawer {...props} onClose={onClose && closeUnlessForAMenu} />
    </KeepOpenOnBackdropPress>
  );
}

function closeNothing(): void {}

export function Dialog({
  open = true,
  size,
  keepsHeight = false,
  title,
  children,
  actions,
  step,
  onClose,
}: DialogProps): ReactNode {
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  useCloseOnEscape(open, onClose, frame);
  if (!open) return null;
  // On the body, so a window opened from inside a card is over the whole page and takes none of the
  // card's styles.
  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog-frame ${size}${keepsHeight ? " keeps-height" : ""}`}
      >
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon={<Icon name="x" />} label="Close (Esc)" size="sm" onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {step && <div className="dialog-step">{step.content}</div>}
        <footer className="dialog-bar">
          {step ? (
            <>
              {step.actions}
              <Button variant="secondary" onClick={step.onCancel}>
                Cancel
              </Button>
            </>
          ) : (
            actions
          )}
          <span className="dialog-bar-gap" />
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** What Escape closes: a window closes before any side panel, whichever opened first. */
export type EscapeLayer = "window" | "side-panel";

/** The side panels open now, the one opened last at the end. */
const openSidePanels: RefObject<HTMLElement | null>[] = [];
const sidePanelListeners = new Set<() => void>();
/** The menus open that aren't the design system's, which `[role="menu"]` finds. */
let escapeWaitsFor = 0;

function changeSidePanels(change: () => void): void {
  change();
  for (const listener of sidePanelListeners) listener();
}

function subscribeToSidePanels(onChange: () => void): () => void {
  sidePanelListeners.add(onChange);
  return () => sidePanelListeners.delete(onChange);
}

/** Windows are on the body, so what opened over another comes later in the document. */
function topmostWindow(): Element | undefined {
  const opened = [...document.querySelectorAll('[aria-modal="true"]')];
  const windows = opened.filter(
    (element) => !openSidePanels.some(({ current }) => current?.contains(element)),
  );
  return windows.at(-1);
}

/** A menu listens on `window`, which is why Escape must get there untouched while one is open. */
function menuIsOpen(): boolean {
  return escapeWaitsFor > 0 || document.querySelector('[role="menu"]') !== null;
}

/** Whether nothing is open over this part of the page. */
export function isTopmost(element: Element | null): boolean {
  if (element === null || menuIsOpen()) return false;
  const topmost = topmostWindow() ?? openSidePanels.at(-1)?.current;
  return topmost === undefined || topmost === null || topmost.contains(element);
}

/** For a menu or a picker that closes itself on Escape on `window`: while `open`, it goes first. */
export function useEscapeWaitsFor(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    escapeWaitsFor += 1;
    return () => {
      escapeWaitsFor -= 1;
    };
  }, [open]);
}

/** Whether this side panel opened after another still open, so it lies over that one. */
export function useOpenedLast(element: RefObject<HTMLElement | null>): boolean {
  return useSyncExternalStore(
    subscribeToSidePanels,
    () => openSidePanels.length > 1 && openSidePanels.at(-1) === element,
  );
}

/**
 * Escape closes `element`, a window or a side panel, unless something is over it, which closes
 * alone: one press closes only the topmost thing.
 */
export function useCloseOnEscape(
  open: boolean,
  onClose: () => void,
  element: RefObject<HTMLElement | null>,
  layer: EscapeLayer = "window",
): void {
  // Read in the capture phase, before any window handles the key: the browser lets React commit
  // between two listeners, so the window over this one can be gone by the time this one's turn
  // comes, and which turn comes first changes with every re-render, as `onClose` does.
  const topmostAtKeyPress = useRef(false);
  useEffect(() => {
    if (!open || layer !== "side-panel") return;
    changeSidePanels(() => openSidePanels.push(element));
    return () => {
      changeSidePanels(() => openSidePanels.splice(openSidePanels.indexOf(element), 1));
    };
  }, [open, element, layer]);
  useEffect(() => {
    if (!open) return;
    const noteWhetherTopmost = (): void => {
      topmostAtKeyPress.current = isTopmost(element.current);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !topmostAtKeyPress.current) return;
      // Kept from `window`, where the design system's Drawer listens for Escape with no idea of
      // what is over it. A field's own Escape, as the mention picker's, comes before `document`.
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", noteWhetherTopmost, { capture: true });
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", noteWhetherTopmost, { capture: true });
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose, element]);
}

export interface TooltipProps {
  readonly content: ReactNode;
  /** Where it prefers to sit; it takes the opposite side when only that has the room. */
  readonly side?: TooltipSide;
  readonly children: ReactNode;
  /** Holds it open or closed, whatever the pointer and focus do. */
  readonly open?: boolean;
}

/** Words on hover or focus of `children`, over everything, kept within the window. */
export function Tooltip({ content, side = "top", children, open }: TooltipProps): ReactNode {
  const [pointedAt, setPointedAt] = useState(false);
  const trigger = useRef<HTMLSpanElement>(null);
  useCloseOnTriggerMove(pointedAt, setPointedAt, trigger);
  return (
    <span
      ref={trigger}
      className="tooltip-trigger"
      onMouseEnter={() => setPointedAt(true)}
      onMouseLeave={() => setPointedAt(false)}
      onFocus={() => setPointedAt(true)}
      onBlur={() => setPointedAt(false)}
    >
      {children}
      {(open ?? pointedAt) && <TooltipBody content={content} side={side} trigger={trigger} />}
    </span>
  );
}

/**
 * On the body and fixed, so nothing around the trigger clips it. It opens hidden, as where it goes
 * depends on its size.
 */
function TooltipBody({
  content,
  side,
  trigger,
}: {
  readonly content: ReactNode;
  readonly side: TooltipSide;
  readonly trigger: RefObject<HTMLElement | null>;
}): ReactNode {
  const body = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<TooltipPlace>();
  useLayoutEffect(() => {
    const [from, shown] = [trigger.current, body.current];
    if (from === null || shown === null) return;
    const placeIt = (): void => {
      const { clientWidth: width, clientHeight: height } = document.documentElement;
      const size = shown.getBoundingClientRect();
      setPlace(tooltipPlace(from.getBoundingClientRect(), size, side, { width, height }));
    };
    placeIt();
    // What it shows can change size while it is open, as a live token count does.
    const resizing = new ResizeObserver(placeIt);
    resizing.observe(shown);
    return () => resizing.disconnect();
  }, [side, trigger]);
  return createPortal(
    <span
      ref={body}
      role="tooltip"
      className="tooltip"
      style={{
        ...(place ?? { visibility: "hidden" }),
        maxWidth: `calc(100vw - ${2 * TOOLTIP_WINDOW_MARGIN_PX}px)`,
      }}
    >
      {content}
    </span>,
    document.body,
  );
}

/**
 * A tooltip doesn't follow its trigger, so it closes once the trigger moves: on a scroll of what
 * holds the trigger, a live log elsewhere on the page leaving it be, and when the window resizes.
 */
function useCloseOnTriggerMove(
  pointedAt: boolean,
  setPointedAt: (pointedAt: boolean) => void,
  trigger: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!pointedAt) return;
    const closeOnScroll = ({ target }: Event): void => {
      if (target instanceof Node && target.contains(trigger.current)) setPointedAt(false);
    };
    const closeOnResize = (): void => setPointedAt(false);
    // Scroll events don't bubble, so only the capture phase hears every scroller.
    window.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, { capture: true });
      window.removeEventListener("resize", closeOnResize);
    };
  }, [pointedAt, setPointedAt, trigger]);
}

function KeepOpenOnBackdropPress({
  ref,
  inline,
  children,
}: {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly inline: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const stopBackdropPress = (event: MouseEvent<HTMLDivElement>): void => {
    if (!inline && event.target === event.currentTarget.firstElementChild) event.stopPropagation();
  };
  return (
    <div ref={ref} style={{ display: "contents" }} onClickCapture={stopBackdropPress}>
      {children}
    </div>
  );
}
