import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes what is open, such as a menu, on a press outside it or on Escape, as the design system's
 * Menu does. `elsewhere` is a part of it drawn outside the returned element, such as a portalled
 * list, where a press is inside it too.
 */
export function useClosedFromOutside(
  open: boolean,
  setOpen: (open: boolean) => void,
  elsewhere?: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement | null> {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPress = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !elsewhere?.current?.contains(target)) setOpen(false);
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
  }, [open, setOpen, elsewhere]);
  return menu;
}
