import type { MenuItem, MenuProps } from "@the-office/ui";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useClosedFromOutside } from "./use-closed-from-outside.ts";
import { usePlacedList } from "./use-placed-list.ts";

/**
 * The design system's Menu, its list drawn on the page's body, fixed to the window, so a scrolling
 * parent such as the board doesn't clip it: below the trigger, or above it when there is no room
 * below.
 * design-system/ stays as exported, so its Menu can't do this itself; the props are the same.
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
  return (
    // Like the design system's Menu, a click inside it is not a click on what holds it.
    <div ref={anchor} className="floating-menu-anchor" onClick={(event) => event.stopPropagation()}>
      <span className="floating-menu-trigger" onClick={() => setOpen(!open)}>
        {trigger}
      </span>
      {open &&
        createPortal(
          <div ref={list} role="menu" className="floating-menu" style={{ width }}>
            {items.map((item, index) => (
              <FloatingMenuItem key={index} item={item} close={() => setOpen(false)} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function FloatingMenuItem({
  item,
  close,
}: {
  readonly item: MenuItem;
  readonly close: () => void;
}): ReactNode {
  if (item.divider) return <div className="floating-menu-divider" />;
  if (item.heading) return <div className="floating-menu-heading">{item.heading}</div>;
  return (
    <button
      type="button"
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
