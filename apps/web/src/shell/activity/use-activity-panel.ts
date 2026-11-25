import { useNavigate, useSearch } from "@tanstack/react-router";
import { closePagePanels } from "../side-panels.ts";

/** Whether the Activity panel is open over the page, and opening and closing it. */
export interface ActivityPanelControls {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

/**
 * The panel lives in the address (`?activity=true`), so it opens over any page; opening it closes
 * the Needs you panel and the conversation's drawer, one side panel at a time (side-panels.ts); the
 * chat drawer stays open under it.
 */
export function useActivityPanel(): ActivityPanelControls {
  const { activity } = useSearch({ strict: false });
  const navigate = useNavigate();
  return {
    isOpen: activity === true,
    open: () => {
      closePagePanels();
      void navigate({
        to: ".",
        search: (current) => ({ ...current, activity: true, needsYou: undefined }),
      });
    },
    close: () =>
      void navigate({ to: ".", search: (current) => ({ ...current, activity: undefined }) }),
  };
}
