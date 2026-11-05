// The design system's Dialog and Drawer close on a press on their dimmed backdrop. A window in The
// Office closes only by Escape, its X or its Close button (docs/spec/4.1-ui-rules.md#windows), so
// the Drawer, and the design system's Dialog while it is still used, get a press landing on the
// backdrop itself stopped before the design system's handler sees it. design-system/ stays as
// exported, hence the wrapper rather than an edit there. The conversation's drawer on the Task and
// Initiative pages is the exception, closing on a press outside: a side view with its draft kept,
// not a window, and built apart from these (apps/web/src/surfaces/work/conversation-drawer.tsx).
import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../design-system/components/core/Button.jsx";
import { Icon } from "../../../design-system/components/core/Icon.jsx";
import { IconButton } from "../../../design-system/components/core/IconButton.jsx";
import {
  Dialog as DesignSystemDialog,
  type DialogProps as DesignSystemDialogProps,
} from "../../../design-system/components/overlays/Dialog.jsx";
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

interface DialogFrameProps {
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

type DialogFrameSizeProps =
  | { readonly size: "small" | "medium"; readonly keepsHeight?: never }
  | {
      readonly size: "large";
      /** For a window whose content changes as the user moves inside it, so it doesn't jump. */
      readonly keepsHeight?: boolean;
    };

/** The design system's Dialog as it was before spec 4.1's frame; task 51's step 6 moves every caller off it and removes it. */
type DesignSystemShapedDialogProps = DesignSystemDialogProps & { readonly size?: never };

export type DialogProps = (DialogFrameProps & DialogFrameSizeProps) | DesignSystemShapedDialogProps;

export function Dialog(props: DialogProps): ReactNode {
  if (props.size === undefined) {
    return (
      <KeepOpenOnBackdropPress inline={props.inline}>
        <DesignSystemDialog {...props} />
      </KeepOpenOnBackdropPress>
    );
  }
  return <DialogFrame {...props} />;
}

export function Drawer(props: DrawerProps): ReactNode {
  return (
    <KeepOpenOnBackdropPress inline={props.inline}>
      <DesignSystemDrawer {...props} />
    </KeepOpenOnBackdropPress>
  );
}

function DialogFrame({
  open = true,
  size,
  keepsHeight = false,
  title,
  children,
  actions,
  step,
  onClose,
}: DialogFrameProps & DialogFrameSizeProps): ReactNode {
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

/** Whether nothing is open over this part of a window, such as the picture viewer, which comes later in the document. */
export function isInTopmostWindow(element: Element | null): boolean {
  const windows = document.querySelectorAll('[aria-modal="true"]');
  return windows[windows.length - 1]?.contains(element) ?? false;
}

/** Escape closes the window, unless one opened over it, which closes first. */
function useCloseOnEscape(
  open: boolean,
  onClose: () => void,
  frame: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && isInTopmostWindow(frame.current)) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, frame]);
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
