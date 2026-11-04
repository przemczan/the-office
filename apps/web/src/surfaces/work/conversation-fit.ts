import { useLayoutEffect, useRef, type RefObject } from "react";

const LEAST_HEIGHT_PX = 320;
const WINDOW_EDGE_GAP_PX = 24;

/** Where the panel can sit, in the page's scroller. */
interface ConversationPlace {
  readonly pageHeight: number;
  /** The top of the columns it sits in, now. */
  readonly columnsTop: number;
  readonly scrolled: number;
  readonly stuckAt: number;
}

/**
 * The conversation's height beside the record. If it fits under what's above it, it reaches down to
 * the window's edge, so its foot shows with the page at its top. If it starts too low for that, it
 * takes the height it has once stuck, which the page's scrolling brings it to: fitted to the little
 * room there, the log would stay a sliver even at the page's end.
 */
export function conversationHeight({
  pageHeight,
  columnsTop,
  scrolled,
  stuckAt,
}: ConversationPlace): number {
  const roomAtPageTop = pageHeight - (columnsTop + scrolled) - WINDOW_EDGE_GAP_PX;
  return roomAtPageTop < LEAST_HEIGHT_PX
    ? pageHeight - stuckAt - WINDOW_EDGE_GAP_PX
    : pageHeight - Math.max(columnsTop, stuckAt) - WINDOW_EDGE_GAP_PX;
}

/**
 * The panel's ref, keeping it fitted to the window while it sticks beside the record, which only the CSS knows.
 * Written straight to the element, as it changes on every scroll of the page.
 */
export function useConversationFit(): RefObject<HTMLElement | null> {
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const page = element?.closest("main");
    const columns = element?.parentElement;
    if (!element || !page || !columns) return;
    const fit = (): void => {
      const { position, top } = getComputedStyle(element);
      element.style.height =
        position === "sticky"
          ? `${conversationHeight({
              pageHeight: page.clientHeight,
              columnsTop: columns.getBoundingClientRect().top - page.getBoundingClientRect().top,
              scrolled: page.scrollTop,
              stuckAt: Number.parseFloat(top),
            })}px`
          : "";
    };
    fit();
    const resizing = new ResizeObserver(fit);
    resizing.observe(page);
    // What sits above the panel grows and shrinks with the page's content.
    if (page.firstElementChild) resizing.observe(page.firstElementChild);
    page.addEventListener("scroll", fit, { passive: true });
    return () => {
      resizing.disconnect();
      page.removeEventListener("scroll", fit);
    };
  }, []);
  return panel;
}
