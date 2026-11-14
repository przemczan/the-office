// `Popover` is the press-to-open companion of `Tooltip` (docs/spec/4.1-ui-rules.md, Components):
// a mark whose information holds links opens it on a press, anchored to the mark. It is no window:
// no head, bar or backdrop. One is open at a time; a press anywhere else, Esc, a second press of its
// trigger or following one of its links closes it. Its Esc goes first, as a menu's does.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip, useEscapeWaitsFor } from "./overlays.tsx";
import { usePlaceUnder } from "./place-under.ts";

export interface PopoverProps {
  /** What the popover holds, named so by its trigger and itself. */
  readonly label: string;
  /** What its trigger shows, such as an icon and a count. */
  readonly trigger: ReactNode;
  readonly triggerClassName?: string;
  /** Words on hover or focus of the trigger while the popover is closed. */
  readonly tooltip?: ReactNode;
  readonly children: ReactNode;
}

/** Closes the popover open now, so opening another closes it. */
let closeOpenPopover: (() => void) | undefined;

/** A screen with no hover, such as a phone's, where only a press can show a mark's words. */
const NO_HOVER_QUERY = "(hover: none)";

const FOCUSABLE = "a[href], button:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function Popover({
  label,
  trigger,
  triggerClassName,
  tooltip,
  children,
}: PopoverProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  // One for the popover's life, as its listeners and its placing depend on it.
  const close = useCallback(() => setOpen(false), []);
  useEscapeWaitsFor(open);

  useEffect(() => {
    if (!open) return;
    closeOpenPopover?.();
    closeOpenPopover = close;
    return () => {
      if (closeOpenPopover === close) closeOpenPopover = undefined;
    };
  }, [open, close]);

  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    // A press on a mark inside a card's stretched link never reaches the link.
    event.preventDefault();
    event.stopPropagation();
    // A click with no pointer behind it comes from Enter or Space.
    setOpenedByKeyboard(event.detail === 0);
    setOpen(!open);
  };

  const shown = (
    <button
      ref={button}
      type="button"
      className={triggerClassName ? `popover-trigger ${triggerClassName}` : "popover-trigger"}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? bodyId : undefined}
      onClick={toggle}
    >
      {trigger}
    </button>
  );
  return (
    <>
      {tooltip === undefined ? (
        shown
      ) : (
        <Tooltip content={tooltip} open={open ? false : undefined}>
          {shown}
        </Tooltip>
      )}
      {open && (
        <PopoverBody
          id={bodyId}
          label={label}
          trigger={button}
          focusFirst={openedByKeyboard}
          onClose={close}
        >
          {children}
        </PopoverBody>
      )}
    </>
  );
}

/**
 * On the body and fixed, so nothing around the trigger clips it and a press inside it touches
 * nothing under the trigger; it follows the trigger as the page scrolls.
 */
function PopoverBody({
  id,
  label,
  trigger,
  focusFirst,
  onClose,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly focusFirst: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const body = useRef<HTMLDivElement>(null);
  const place = usePlaceUnder(trigger, body, onClose);
  useCloseOnPressOutside(trigger, body, onClose);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      onClose();
      trigger.current?.focus();
    };
    // On `window`, as a menu's: `useEscapeWaitsFor` keeps any window under it from closing too.
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, trigger]);

  useEffect(() => {
    if (!focusFirst) return;
    (body.current?.querySelector<HTMLElement>(FOCUSABLE) ?? body.current)?.focus();
  }, [focusFirst]);

  /** Its links come after its trigger in the Tab order, though it lies at the end of the page. */
  const keepTabOrder = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") return;
    const stops = [...(body.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const atStart = stops.length === 0 || document.activeElement === stops[0];
    const atEnd = stops.length === 0 || document.activeElement === stops.at(-1);
    if (event.shiftKey && atStart) {
      event.preventDefault();
      trigger.current?.focus();
    } else if (!event.shiftKey && atEnd) {
      // From the trigger, the browser's own Tab goes on to what follows it.
      trigger.current?.focus();
      onClose();
    }
  };

  const closeOnLink = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest("a")) onClose();
  };

  return createPortal(
    <div
      ref={body}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="popover"
      style={place ?? { visibility: "hidden" }}
      onKeyDown={keepTabOrder}
      onClick={closeOnLink}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * A press anywhere but on the popover or its trigger closes it, and goes on to do what it does; a
 * press on the trigger is its own, which closes it.
 */
function useCloseOnPressOutside(
  trigger: RefObject<HTMLElement | null>,
  body: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const closeOutside = ({ target }: PointerEvent): void => {
      if (!(target instanceof Node)) return;
      if (trigger.current?.contains(target) || body.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", closeOutside, { capture: true });
    return () => window.removeEventListener("pointerdown", closeOutside, { capture: true });
  }, [trigger, body, onClose]);
}

export interface PlainMarkProps {
  /** The mark's words, which also name it. */
  readonly words: string;
  readonly className?: string;
  /** What the mark shows, such as an icon. */
  readonly children: ReactNode;
}

/**
 * A mark that stands for words, such as an icon on a card: they show in the `Tooltip` on hover and
 * keyboard focus, and in a `Popover` on a press on a screen without hover.
 */
export function PlainMark({ words, className, children }: PlainMarkProps): ReactNode {
  const noHover = useSyncExternalStore(subscribeToHover, screenHasNoHover);
  const classes = className ? `plain-mark ${className}` : "plain-mark";
  if (noHover) {
    return (
      <Popover label={words} trigger={children} triggerClassName={classes}>
        <p className="popover-words">{words}</p>
      </Popover>
    );
  }
  return (
    <Tooltip content={words} focusable>
      <span className={classes} role="img" aria-label={words}>
        {children}
      </span>
    </Tooltip>
  );
}

function screenHasNoHover(): boolean {
  return window.matchMedia(NO_HOVER_QUERY).matches;
}

function subscribeToHover(onChange: () => void): () => void {
  const query = window.matchMedia(NO_HOVER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
