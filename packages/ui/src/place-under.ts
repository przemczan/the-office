// Places what opens from a trigger, such as a popover or a select's list, fixed on the page under
// the trigger, or over it when only that has the room, so nothing around the trigger clips it.
import { useLayoutEffect, useState, type RefObject } from "react";
import { popoverPlace, type TooltipPlace } from "./tooltip-place.ts";

/** Under the trigger, placed again as the page scrolls or resizes; closed once it leaves the view. */
export function usePlaceUnder(
  trigger: RefObject<HTMLElement | null>,
  body: RefObject<HTMLElement | null>,
  onClose: () => void,
): TooltipPlace | undefined {
  const [place, setPlace] = useState<TooltipPlace>();
  useLayoutEffect(() => {
    const [from, shown] = [trigger.current, body.current];
    if (from === null || shown === null) return;
    const placeIt = (): void => {
      const { clientWidth: width, clientHeight: height } = document.documentElement;
      const anchor = from.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > height) {
        onClose();
        return;
      }
      setPlace(popoverPlace(anchor, shown.getBoundingClientRect(), { width, height }));
    };
    placeIt();
    const resizing = new ResizeObserver(placeIt);
    resizing.observe(shown);
    // Scroll events don't bubble, so only the capture phase hears every scroller.
    window.addEventListener("scroll", placeIt, { capture: true, passive: true });
    window.addEventListener("resize", placeIt);
    return () => {
      resizing.disconnect();
      window.removeEventListener("scroll", placeIt, { capture: true });
      window.removeEventListener("resize", placeIt);
    };
  }, [trigger, body, onClose]);
  return place;
}
