import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes what is open, such as a menu, on a press outside it or on Escape, as the design system's
 * Menu does.
 */
export function useClosedFromOutside(
  open: boolean,
  setOpen: (open: boolean) => void,
): RefObject<HTMLDivElement | null> {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPress = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPress);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPress);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  return menu;
}
