// `Dialog` is the window of docs/spec/4.1-ui-rules.md#windows: four sizes and one frame, which a
// preview can maximize, closed by Escape, its X, its Close button or a press on its dimmed
// backdrop. A press outside is the one way to close it by accident, so a window holding unsaved
// input asks first, in a step over its bar. The design system's Drawer closes on any click on its
// backdrop, a drag from inside it included, so the wrapper takes that click over and closes it on a
// press outside as a window closes. design-system/ stays as exported, hence the wrapper rather than
// an edit there. The conversation's drawer on the Task and Initiative pages closes on a press
// outside too, built apart from these (apps/web/src/surfaces/work/conversation-drawer.tsx); the chat
// drawer has no backdrop and stays open beside the page. `Tooltip` is built here too (its press-to-open
// companion, `Popover`, in popover.tsx): the design system's sits inside its trigger, where anything
// clipping or stacking around it covers it. A popover's Esc goes first, as a menu's does. One press
// of Escape closes one thing: a menu first, then a window, then the side panel opened last (the chat
// drawer, the Needs you panel, the conversation's drawer), by the order in `openSidePanels`.
import {
  useCallback,
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
import { Icon } from "../../../design-system/components/core/Icon.jsx";
import {
  Drawer as DesignSystemDrawer,
  type DrawerProps,
} from "../../../design-system/components/overlays/Drawer.jsx";
import { Button, IconButton } from "./sized-controls.tsx";
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
  /**
   * Offers Maximize next to the X: the window fills the browser window, less a margin, until
   * Restore. Each opening starts at the window's own size.
   */
  readonly maximizable?: boolean;
  /**
   * Whether closing the window loses what the user entered, so a press outside asks first. Left
   * out, it is whether any field inside has had input since the window opened. A form that knows
   * its own state, or a choice made without a field, says it; a window whose fields only search or
   * filter says `false`.
   */
  readonly unsavedChanges?: boolean;
  readonly onClose: () => void;
}

/**
 * A confirmation (small), a form (medium), something to read or look at (large), or something to
 * look at closely, such as a preview (extra large).
 */
export type DialogSize = "small" | "medium" | "large" | "extra-large";

type DialogSizeProps =
  | { readonly size: "small"; readonly keepsHeight?: never }
  | {
      readonly size: "medium" | "large" | "extra-large";
      /**
       * For a window whose content changes as the user moves inside it, so it doesn't jump: 640px
       * high when medium, 86% of the browser window when large or extra large, less when the
       * browser is shorter.
       */
      readonly keepsHeight?: boolean;
    };

export type DialogProps = DialogContentProps & DialogSizeProps;

export function Drawer(props: DrawerProps): ReactNode {
  const { open = true, inline = false, onClose } = props;
  const frame = useRef<HTMLDivElement>(null);
  const closable = open && !inline && !!onClose;
  useCloseOnEscape(closable, onClose ?? closeNothing, frame, "side-panel");
  const backdrop = useCallback(() => frame.current?.firstElementChild ?? null, []);
  const pressedOutside = usePressOutside(closable, frame, backdrop);
  // Its own Escape listens on `window`, as a menu's does, so a press meant for a menu reaches it too.
  const closeUnlessForAMenu = (): void => {
    if (!menuIsOpen()) onClose?.();
  };
  // Stopped before the design system's handler, which would close on any click landing on it.
  const closeOnPressOutside = (event: MouseEvent<HTMLDivElement>): void => {
    if (!closable || event.target !== backdrop()) return;
    event.stopPropagation();
    if (pressedOutside()) onClose?.();
  };
  return (
    <div ref={frame} style={{ display: "contents" }} onClickCapture={closeOnPressOutside}>
      <DesignSystemDrawer {...props} onClose={onClose && closeUnlessForAMenu} />
    </div>
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
  maximizable = false,
  unsavedChanges,
  onClose,
}: DialogProps): ReactNode {
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [entered, setEntered] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  useCloseOnEscape(open, onClose, frame);
  const backdropElement = useCallback(() => backdrop.current, []);
  const pressedOutside = usePressOutside(open, frame, backdropElement);
  // A window kept mounted while closed opens again at its own size, with nothing entered.
  if (!open && (maximized || entered || confirmingClose)) {
    setMaximized(false);
    setEntered(false);
    setConfirmingClose(false);
  }
  if (!open) return null;
  const holdsUnsavedInput = unsavedChanges ?? entered;
  const closeOnPressOutside = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || !pressedOutside()) return;
    if (holdsUnsavedInput) setConfirmingClose(true);
    else onClose();
  };
  // In the capture phase, so a field that stops its events still counts; a picker portalled out of
  // the window still bubbles through it in React's tree.
  const noteInput = (): void => {
    if (!entered) setEntered(true);
  };
  const closeStep: DialogStep | undefined = confirmingClose
    ? {
        content: (
          <>
            <strong>Close without saving?</strong> What you entered here will be lost.
          </>
        ),
        actions: (
          <Button variant="danger" onClick={onClose}>
            Close without saving
          </Button>
        ),
        onCancel: () => setConfirmingClose(false),
      }
    : undefined;
  const barStep = closeStep ?? step;
  const isMaximized = maximizable && maximized;
  const frameClasses = ["dialog-frame", size];
  if (keepsHeight) frameClasses.push("keeps-height");
  if (isMaximized) frameClasses.push("maximized");
  // On the body, so a window opened from inside a card is over the whole page and takes none of the
  // card's styles.
  return createPortal(
    <div
      ref={backdrop}
      className={`dialog-backdrop${isMaximized ? " maximized" : ""}`}
      onClick={closeOnPressOutside}
    >
      <div
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={frameClasses.join(" ")}
        onInputCapture={noteInput}
        onChangeCapture={noteInput}
      >
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          {maximizable && (
            <IconButton
              icon={<Icon name={isMaximized ? "minimize-2" : "maximize-2"} />}
              label={isMaximized ? "Restore" : "Maximize"}
              size="sm"
              onClick={() => setMaximized(!isMaximized)}
            />
          )}
          <IconButton icon={<Icon name="x" />} label="Close (Esc)" size="sm" onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {/* Kept while the confirmation is over it, so Cancel brings it back as it was. */}
        {step && (
          <div className="dialog-step" hidden={confirmingClose}>
            {step.content}
          </div>
        )}
        {closeStep && <div className="dialog-step">{closeStep.content}</div>}
        <footer className="dialog-bar">
          {barStep ? (
            <>
              {barStep.actions}
              <Button variant="secondary" onClick={barStep.onCancel}>
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

/** Where longer words wrap, so they read as a short paragraph rather than one long line. */
const TOOLTIP_READING_WIDTH_PX = 300;

export interface TooltipProps {
  readonly content: ReactNode;
  /** Where it prefers to sit; it takes the opposite side when only that has the room. */
  readonly side?: TooltipSide;
  readonly children: ReactNode;
  /** Holds it open or closed, whatever the pointer and focus do. */
  readonly open?: boolean;
  /** Makes the trigger a focus stop, for `children` that aren't one, such as an icon. */
  readonly focusable?: boolean;
}

/** Words on hover or focus of `children`, over everything, kept within the window. */
export function Tooltip({
  content,
  side = "top",
  children,
  open,
  focusable = false,
}: TooltipProps): ReactNode {
  const [pointedAt, setPointedAt] = useState(false);
  // Held as state, not a ref: a Tooltip mounted open runs its body's layout effect before a ref on
  // the trigger is attached, so the body waits for the trigger's element instead.
  const [trigger, setTrigger] = useState<HTMLSpanElement | null>(null);
  useCloseOnTriggerMove(pointedAt, setPointedAt, trigger);
  return (
    <span
      ref={setTrigger}
      className="tooltip-trigger"
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={() => setPointedAt(true)}
      onMouseLeave={() => setPointedAt(false)}
      onFocus={() => setPointedAt(true)}
      onBlur={() => setPointedAt(false)}
    >
      {children}
      {(open ?? pointedAt) && trigger !== null && (
        <TooltipBody content={content} side={side} trigger={trigger} />
      )}
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
  readonly trigger: HTMLElement;
}): ReactNode {
  const body = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<TooltipPlace>();
  const placeIt = useCallback((): void => {
    const shown = body.current;
    if (shown === null) return;
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    const size = shown.getBoundingClientRect();
    const next = tooltipPlace(trigger.getBoundingClientRect(), size, side, { width, height });
    // The same place keeps the same state, so placing on each render settles.
    setPlace((last) => (last?.left === next.left && last.top === next.top ? last : next));
  }, [side, trigger]);
  // On each render: a Tooltip held open moves with its trigger, as a chart's hovered point does.
  useLayoutEffect(placeIt);
  useLayoutEffect(() => {
    const shown = body.current;
    if (shown === null) return;
    // What it shows can change size while it is open, as a live token count does.
    const resizing = new ResizeObserver(placeIt);
    resizing.observe(shown);
    return () => resizing.disconnect();
  }, [placeIt]);
  return createPortal(
    <span
      ref={body}
      role="tooltip"
      className="tooltip"
      style={{
        ...(place ?? { visibility: "hidden" }),
        maxWidth: `min(${TOOLTIP_READING_WIDTH_PX}px, calc(100vw - ${2 * TOOLTIP_WINDOW_MARGIN_PX}px))`,
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
  trigger: HTMLElement | null,
): void {
  useEffect(() => {
    if (!pointedAt) return;
    const closeOnScroll = ({ target }: Event): void => {
      if (target instanceof Node && target.contains(trigger)) setPointedAt(false);
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

interface BackdropPress {
  startedOnBackdrop: boolean;
  endedOnBackdrop: boolean;
}

/**
 * Whether the click now landing on the backdrop of `element`, a window or a side panel, was a
 * press outside it: one that started and ended on the backdrop while nothing was open over it. A
 * drag from inside lets go on the backdrop, and its click lands there too; a press closing a menu
 * or a popover inside closes only that.
 */
function usePressOutside(
  open: boolean,
  element: RefObject<HTMLElement | null>,
  backdrop: () => Element | null,
): () => boolean {
  const press = useRef<BackdropPress>({ startedOnBackdrop: false, endedOnBackdrop: false });
  useEffect(() => {
    if (!open) return;
    // In the capture phase on `window`, before a popover closes on the same press, as Escape's
    // topmost check is read before a menu closes.
    const noteStart = ({ target }: PointerEvent): void => {
      press.current = {
        startedOnBackdrop: target === backdrop() && isTopmost(element.current),
        endedOnBackdrop: false,
      };
    };
    const noteEnd = ({ target }: PointerEvent): void => {
      press.current.endedOnBackdrop = target === backdrop();
    };
    window.addEventListener("pointerdown", noteStart, { capture: true });
    window.addEventListener("pointerup", noteEnd, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", noteStart, { capture: true });
      window.removeEventListener("pointerup", noteEnd, { capture: true });
    };
  }, [open, element, backdrop]);
  return () => {
    const { startedOnBackdrop, endedOnBackdrop } = press.current;
    press.current = { startedOnBackdrop: false, endedOnBackdrop: false };
    return startedOnBackdrop && endedOnBackdrop;
  };
}
