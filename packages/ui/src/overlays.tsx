// `Dialog` is the window of docs/spec/4.1-ui-rules.md#windows: three sizes and one frame, closed only
// by Escape, its X or its Close button. The design system's Drawer closes on a press on its dimmed
// backdrop, so a press landing on the backdrop itself is stopped before its handler sees it.
// design-system/ stays as exported, hence the wrapper rather than an edit there. The conversation's
// drawer on the Task and Initiative pages is the exception, closing on a press outside: a side view
// with its draft kept, not a window, and built apart from these
// (apps/web/src/surfaces/work/conversation-drawer.tsx).
import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../design-system/components/core/Button.jsx";
import { Icon } from "../../../design-system/components/core/Icon.jsx";
import { IconButton } from "../../../design-system/components/core/IconButton.jsx";
import {
  Drawer as DesignSystemDrawer,
  type DrawerProps,
} from "../../../design-system/components/overlays/Drawer.jsx";

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
  | { readonly size: "small" | "medium"; readonly keepsHeight?: never }
  | {
      readonly size: "large";
      /** For a window whose content changes as the user moves inside it, so it doesn't jump. */
      readonly keepsHeight?: boolean;
    };

export type DialogProps = DialogContentProps & DialogSizeProps;

export function Drawer(props: DrawerProps): ReactNode {
  return (
    <KeepOpenOnBackdropPress inline={props.inline}>
      <DesignSystemDrawer {...props} />
    </KeepOpenOnBackdropPress>
  );
}

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

/**
 * Whether nothing is open over this part of the page. Windows are on the body and the panels in the
 * app, so what opened over another comes later in the document.
 */
export function isTopmost(element: Element | null): boolean {
  if (element === null) return false;
  const opened = document.querySelectorAll('[aria-modal="true"]');
  const topmost = opened[opened.length - 1];
  return topmost === undefined || topmost.contains(element);
}

/**
 * Escape closes `element`, a window or a panel, unless something opened over it, which closes
 * alone: one press closes only the topmost thing.
 */
export function useCloseOnEscape(
  open: boolean,
  onClose: () => void,
  element: RefObject<HTMLElement | null>,
): void {
  // Read in the capture phase, before any window handles the key: the browser lets React commit
  // between two listeners, so the window over this one can be gone by the time this one's turn
  // comes, and which turn comes first changes with every re-render, as `onClose` does.
  const topmostAtKeyPress = useRef(false);
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

function KeepOpenOnBackdropPress({
  inline,
  children,
}: {
  readonly inline: boolean | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const stopBackdropPress = (event: MouseEvent<HTMLDivElement>): void => {
    if (!inline && event.target === event.currentTarget.firstElementChild) event.stopPropagation();
  };
  return (
    <div style={{ display: "contents" }} onClickCapture={stopBackdropPress}>
      {children}
    </div>
  );
}
