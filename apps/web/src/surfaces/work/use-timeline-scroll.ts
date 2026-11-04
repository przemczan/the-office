import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Near enough to the end to count as reading it, whatever a line's height. */
const AT_END_PX = 40;

const END = Symbol("the timeline's end");

/** What the timeline stays on as its chapters load and grow: its end, a Thread's chapter, or nothing. */
type Anchor = typeof END | string | undefined;

export interface TimelineScroll {
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly chapters: RefObject<HTMLDivElement | null>;
}

/** The chapter's element id, for `bringChapterIntoView` and the landing here. */
export function chapterElementId(threadId: string): string {
  return `chapter-${threadId}`;
}

/**
 * Brings a Thread's chapter into view, the page around it too, for a link the user follows. The
 * address alone can't: a link followed again leaves it as it was.
 */
export function bringChapterIntoView(threadId: string): void {
  document.getElementById(chapterElementId(threadId))?.scrollIntoView({ block: "start" });
}

/**
 * Keeps the timeline on the Thread the address names, else its end, while chapters load, until the
 * reader takes over; reaching the end again goes back to following it. A linked Decision's card
 * outranks either, once. Only `scrollTop` moves, as scrollIntoView would scroll the page too: a
 * message coming in must never move the page around the timeline.
 */
export function useTimelineScroll(landOn: string | undefined): TimelineScroll {
  const scroller = useRef<HTMLDivElement>(null);
  const chapters = useRef<HTMLDivElement>(null);
  const anchor = useRef<Anchor>(landOn ?? END);

  const settle = useCallback((): void => {
    const view = scroller.current;
    if (view === null || anchor.current === undefined) return;
    const linkedCard = view.querySelector(".decision-card.linked-to");
    if (linkedCard !== null) {
      view.scrollTop += centredOffset(view, linkedCard);
      anchor.current = undefined;
    } else if (anchor.current === END) {
      view.scrollTop = view.scrollHeight;
    } else {
      const chapter = document.getElementById(chapterElementId(anchor.current));
      if (chapter !== null) view.scrollTop += topOffset(view, chapter);
    }
  }, []);

  useEffect(() => {
    if (landOn === undefined) return;
    anchor.current = landOn;
    settle();
  }, [landOn, settle]);

  useEffect(() => {
    const view = scroller.current;
    const content = chapters.current;
    if (view === null || content === null) return;
    const release = (): void => {
      anchor.current = undefined;
    };
    const followAtEnd = (): void => {
      const toEnd = view.scrollHeight - view.scrollTop - view.clientHeight;
      if (anchor.current === undefined && toEnd < AT_END_PX) anchor.current = END;
    };
    const growing = new ResizeObserver(settle);
    growing.observe(content);
    const takingOver = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of takingOver) view.addEventListener(event, release, { passive: true });
    view.addEventListener("scroll", followAtEnd, { passive: true });
    return () => {
      growing.disconnect();
      for (const event of takingOver) view.removeEventListener(event, release);
      view.removeEventListener("scroll", followAtEnd);
    };
  }, [settle]);

  return { scroller, chapters };
}

function topOffset(view: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientTop;
}

function centredOffset(view: HTMLElement, element: Element): number {
  const { height } = element.getBoundingClientRect();
  return topOffset(view, element) - (view.clientHeight - height) / 2;
}
