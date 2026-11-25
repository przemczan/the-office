import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

/**
 * One side panel over the page at a time (spec §4): the Needs you panel, Activity and the
 * conversation's drawer each close the others as they open, and the chat drawer, which they cover,
 * closes all three as it opens. The shell's two panels live in the address; the page's own, the
 * conversation's drawer, says here how it closes while it is open.
 */

/** The address's part that closes the shell's panels over the page. */
export const SHELL_PANELS_CLOSED = { needsYou: undefined, activity: undefined } as const;

const pagePanelClosers = new Set<() => void>();

/** Closes the page's own side panel, if one is open. */
export function closePagePanels(): void {
  for (const close of pagePanelClosers) close();
}

/** While `open`, the page's own side panel closes as another side panel or the chat opens. */
export function usePagePanel(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    pagePanelClosers.add(close);
    return () => {
      pagePanelClosers.delete(close);
    };
  }, [open, close]);
}

/**
 * Closes the Needs you panel and Activity, in one move of the address and only when one is open,
 * so Back doesn't step through an address that changed nothing.
 */
export function useClosingShellPanels(): () => void {
  const router = useRouter();
  return useCallback(() => {
    const { needsYou, activity } = router.state.location.search;
    if (needsYou === undefined && activity === undefined) return;
    void router.navigate({
      to: ".",
      search: (current) => ({ ...current, ...SHELL_PANELS_CLOSED }),
      hash: true,
      resetScroll: false,
    });
  }, [router]);
}
