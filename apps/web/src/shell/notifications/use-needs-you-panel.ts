import { useNavigate, useSearch } from "@tanstack/react-router";
import { closePagePanels } from "../side-panels.ts";

/** Whether the Needs you panel is open over the page, and opening and closing it. */
export interface NeedsYouPanelControls {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

/**
 * The panel lives in the address (`?needsYou=true`), so it opens over any page; opening it closes
 * the Activity panel and the conversation's drawer, one side panel at a time (side-panels.ts); the
 * chat drawer stays open under it.
 */
export function useNeedsYouPanel(): NeedsYouPanelControls {
  const { needsYou } = useSearch({ strict: false });
  const navigate = useNavigate();
  return {
    isOpen: needsYou === true,
    open: () => {
      closePagePanels();
      void navigate({
        to: ".",
        search: (current) => ({ ...current, needsYou: true, activity: undefined }),
      });
    },
    close: () =>
      void navigate({ to: ".", search: (current) => ({ ...current, needsYou: undefined }) }),
  };
}
