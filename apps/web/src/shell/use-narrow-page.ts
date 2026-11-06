import { useSyncExternalStore } from "react";

/** The 900px of a narrow window, less the rail: a page folds by its own width, as the chat drawer takes some. */
const NARROW_PAGE_WIDTH_PX = 844;

/** The page's part of the shell; `.shell-main` is also the CSS's `page` container. */
function pageElement(): Element | null {
  return document.querySelector(".shell-main");
}

/** Whether the page has too little room for a side column, and folds it into a drawer. */
export function useNarrowPage(): boolean {
  return useSyncExternalStore(subscribeToPageWidth, pageIsNarrow);
}

function subscribeToPageWidth(changed: () => void): () => void {
  const page = pageElement();
  if (!page) return () => undefined;
  const resizing = new ResizeObserver(changed);
  resizing.observe(page);
  return () => resizing.disconnect();
}

function pageIsNarrow(): boolean {
  const page = pageElement();
  return page !== null && page.clientWidth <= NARROW_PAGE_WIDTH_PX;
}
