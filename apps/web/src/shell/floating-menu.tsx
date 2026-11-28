import type { MenuItem, MenuProps } from "@the-office/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useClosedFromOutside } from "./use-closed-from-outside.ts";
import { usePlacedList } from "./use-placed-list.ts";

/**
 * The design system's Menu, its list drawn on the page's body, fixed to the window, so a scrolling
 * parent such as the board doesn't clip it: below the trigger, or above it when there is no room
 * below.
 * design-system/ stays as it is, so its Menu can't do this itself; the props are the same.
 * As a menu button's, it takes focus to its first item as it opens; Up and Down move between its
 * items, Home and End to the first and the last; choosing one, Esc or Tab closes it, giving focus
 * back to the trigger.
 */
export function FloatingMenu({
  trigger,
  items = [],
  align = "end",
  width = 200,
  open: controlledOpen,
  onOpenChange,
}: Omit<MenuProps, "style">): ReactNode {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = useCallback(
    (next: boolean): void => {
      setOwnOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const list = useRef<HTMLDivElement>(null);
  const anchor = useClosedFromOutside(open, setOpen, list);
  usePlacedList(open, anchor, list, align);
  const giveFocusBack = useMenuFocus(open, anchor, list);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      // The menu closes on Escape on `window` (`useClosedFromOutside`), after this.
      giveFocusBack();
      return;
    }
    if (event.key === "Tab") {
      // Focus goes back before the browser moves it, so Tab goes on from the trigger.
      focusableIn(anchor.current)?.focus();
      setOpen(false);
      return;
    }
    const next = itemAfterKey(event.key, itemsOf(list.current), document.activeElement);
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  };
  return (
    // Like the design system's Menu, a click inside it is not a click on what holds it.
    <div ref={anchor} className="floating-menu-anchor" onClick={(event) => event.stopPropagation()}>
      <span className="floating-menu-trigger" onClick={() => setOpen(!open)}>
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={list}
            role="menu"
            className="floating-menu"
            style={{ width }}
            onKeyDown={onKeyDown}
          >
            {items.map((item, index) => (
              <FloatingMenuItem
                key={index}
                item={item}
                close={() => {
                  giveFocusBack();
                  setOpen(false);
                }}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * Focuses the first item as the menu opens; once it closes after the returned function was called,
 * focuses the trigger again, unless something else, such as a window an item opened, took focus.
 */
function useMenuFocus(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
): () => void {
  const focusBack = useRef(false);
  useEffect(() => {
    if (open) {
      focusBack.current = false;
      itemsOf(list.current)[0]?.focus({ preventScroll: true });
      return;
    }
    if (!focusBack.current) return;
    focusBack.current = false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) {
      focusableIn(anchor.current)?.focus({ preventScroll: true });
    }
  }, [open, anchor, list]);
  return () => {
    focusBack.current = true;
  };
}

/** The items that can be chosen, in order: headings, dividers and disabled items are skipped. */
function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
}

/** The item a key moves focus to, going round at either end; undefined for any other key. */
function itemAfterKey(
  key: string,
  items: readonly HTMLElement[],
  focused: Element | null,
): HTMLElement | undefined {
  const at = items.findIndex((item) => item === focused);
  switch (key) {
    case "ArrowDown":
      return items[(at + 1) % items.length];
    case "ArrowUp":
      return items[(at <= 0 ? items.length : at) - 1];
    case "Home":
      return items[0];
    case "End":
      return items.at(-1);
    default:
      return undefined;
  }
}

/** The trigger's own control, which focus goes back to. */
function focusableIn(anchor: HTMLElement | null): HTMLElement | null {
  return (
    anchor?.querySelector<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])") ?? null
  );
}

function FloatingMenuItem({
  item,
  close,
}: {
  readonly item: MenuItem;
  readonly close: () => void;
}): ReactNode {
  if (item.divider) return <div role="separator" className="floating-menu-divider" />;
  if (item.heading) {
    return (
      <div role="presentation" className="floating-menu-heading">
        {item.heading}
      </div>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={item.danger ? "floating-menu-item danger" : "floating-menu-item"}
      disabled={item.disabled}
      onClick={() => {
        item.onSelect?.();
        close();
      }}
    >
      {item.icon && <span className="floating-menu-icon">{item.icon}</span>}
      <span className="floating-menu-label">{item.label}</span>
      {item.shortcut && <kbd>{item.shortcut}</kbd>}
    </button>
  );
}
