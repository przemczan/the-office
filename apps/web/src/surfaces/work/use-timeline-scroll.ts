import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Near enough to the end to count as reading it, whatever a line's height. */
const AT_END_PX = 40;

const END = Symbol("the timeline's end");

/** What the timeline stays on as its chapters load and grow: its end, a Thread's chapter, or nothing. */
type Anchor = typeof END | string | undefined;

export interface TimelineScroll {
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly chapters: RefObject<HTMLDivElement | null>;
  /** Whether what lands in this Thread comes into view by itself, its chapter unfolded. */
  readonly follows: (threadId: string) => boolean;
  /** Goes to the Thread's newest messages and stays on them; with none, to the timeline's end. */
  readonly follow: (threadId?: string) => void;
}

/** The chapter's element id, for the landing here. */
export function chapterElementId(threadId: string): string {
  return `chapter-${threadId}`;
}

/**
 * Keeps the timeline on the newest messages of the Thread the address names, else on its end, while
 * chapters load and messages land, until the reader takes over: moving up from the end, or anything
 * they do on a Thread's chapter. A reader who took over is never moved; reaching the end again goes
 * back to following it. A linked Decision's card outranks all of it, once. Only `scrollTop` moves,
 * as scrollIntoView would scroll the page too: a message coming in must never move the page around
 * the timeline.
 */
export function useTimelineScroll(landOn: string | undefined): TimelineScroll {
  const scroller = useRef<HTMLDivElement>(null);
  const chapters = useRef<HTMLDivElement>(null);
  const anchor = useRef<Anchor>(landOn ?? END);
  // The anchor for drawing; the ref is for the listeners, which must not wait for a render.
  const [shownAnchor, setShownAnchor] = useState<Anchor>(landOn ?? END);
  const [landedOn, setLandedOn] = useState(landOn);
  if (landOn !== landedOn) {
    setLandedOn(landOn);
    if (landOn !== undefined) setShownAnchor(landOn);
  }

  const anchorOn = useCallback((next: Anchor): void => {
    anchor.current = next;
    setShownAnchor(next);
  }, []);

  const settle = useCallback((): void => {
    const view = scroller.current;
    if (view === null || anchor.current === undefined) return;
    const linkedCard = view.querySelector(".decision-card.linked-to");
    if (linkedCard !== null) {
      view.scrollTop += centredOffset(view, linkedCard);
      anchorOn(undefined);
    } else if (anchor.current === END) {
      view.scrollTop = view.scrollHeight;
    } else {
      const chapter = document.getElementById(chapterElementId(anchor.current));
      if (chapter !== null) view.scrollTop += newestOffset(view, chapter);
    }
  }, [anchorOn]);

  const follow = useCallback(
    (threadId?: string): void => {
      anchorOn(threadId ?? END);
      settle();
    },
    [anchorOn, settle],
  );

  useEffect(() => {
    if (landOn === undefined) return;
    anchor.current = landOn;
    settle();
  }, [landOn, settle]);

  useEffect(() => {
    const view = scroller.current;
    const content = chapters.current;
    if (view === null || content === null) return;
    let lastTop = view.scrollTop;
    const takeOverChapter = (): void => {
      if (anchor.current === END) return;
      anchorOn(isAtEnd(view) ? END : undefined);
    };
    // Going by the way it moved, not by where it is: a scroll still to be reported when messages
    // land would otherwise read as the reader leaving the end.
    const watchReader = (): void => {
      const movedUp = view.scrollTop < lastTop;
      lastTop = view.scrollTop;
      if (isAtEnd(view)) {
        if (anchor.current === undefined) anchorOn(END);
      } else if (movedUp && anchor.current === END) {
        anchorOn(undefined);
      }
    };
    const growing = new ResizeObserver(settle);
    growing.observe(content);
    // The panel changes height as the page scrolls (useConversationFit), which must not lose the end.
    growing.observe(view);
    const takingOver = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of takingOver) {
      view.addEventListener(event, takeOverChapter, { passive: true });
    }
    view.addEventListener("scroll", watchReader, { passive: true });
    return () => {
      growing.disconnect();
      for (const event of takingOver) view.removeEventListener(event, takeOverChapter);
      view.removeEventListener("scroll", watchReader);
    };
  }, [anchorOn, settle]);

  const follows = (threadId: string): boolean => shownAnchor === END || shownAnchor === threadId;
  return { scroller, chapters, follows, follow };
}

function isAtEnd(view: HTMLElement): boolean {
  return view.scrollHeight - view.scrollTop - view.clientHeight < AT_END_PX;
}

function topOffset(view: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientTop;
}

/** To the chapter's top if it all fits, else to its end, where its newest messages are. */
function newestOffset(view: HTMLElement, chapter: Element): number {
  const { height } = chapter.getBoundingClientRect();
  return topOffset(view, chapter) + Math.max(0, height - view.clientHeight);
}

function centredOffset(view: HTMLElement, element: Element): number {
  const { height } = element.getBoundingClientRect();
  return topOffset(view, element) - (view.clientHeight - height) / 2;
}
