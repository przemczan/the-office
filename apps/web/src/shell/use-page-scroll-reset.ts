import { useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Gives the page's scrolling element a ref that starts it at its top when the path changes (Now to
 * Work, one Project to another), and keeps its place when only the search does (a panel, a filter,
 * `?chat=`). The router's own scroll restoration keys by history entry, which a search change makes
 * new, so it can't tell the two apart.
 */
export function usePageScrollReset(): RefObject<HTMLElement | null> {
  const page = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const scrolledPath = useRef(pathname);
  useLayoutEffect(() => {
    if (scrolledPath.current === pathname) return;
    scrolledPath.current = pathname;
    if (page.current) page.current.scrollTop = 0;
  }, [pathname]);
  return page;
}
