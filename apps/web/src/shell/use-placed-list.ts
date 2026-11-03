import { useLayoutEffect, type RefObject } from "react";
import { menuPlacement } from "./menu-placement.ts";

/**
 * Places an open list drawn on the page's body where `menuPlacement` says, measured and set on the
 * element before it paints (the list is hidden until then, `.floating-menu`), and again as the page
 * scrolls or the window resizes, since the list is fixed to the window and its trigger moves.
 */
export function usePlacedList(
  open: boolean,
  anchor: RefObject<HTMLDivElement | null>,
  list: RefObject<HTMLDivElement | null>,
  align: "start" | "end",
): void {
  useLayoutEffect(() => {
    const trigger = anchor.current;
    const element = list.current;
    if (!open || !trigger || !element) return;
    const place = (): void => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      const { top, left } = menuPlacement(trigger.getBoundingClientRect(), size, viewport, align);
      element.style.setProperty("top", `${top}px`);
      element.style.setProperty("left", `${left}px`);
      element.style.setProperty("visibility", "visible");
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, align, anchor, list]);
}
