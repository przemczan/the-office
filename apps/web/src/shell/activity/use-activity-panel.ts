import { useNavigate, useSearch } from "@tanstack/react-router";

/** Whether the Activity panel is open over the page, and opening and closing it. */
export interface ActivityPanelControls {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

/**
 * The panel lives in the address (`?activity=true`), so it opens over any page; opening it takes
 * the Needs you panel's place, as the two lie over the page in the same spot.
 */
export function useActivityPanel(): ActivityPanelControls {
  const { activity } = useSearch({ strict: false });
  const navigate = useNavigate();
  return {
    isOpen: activity === true,
    open: () =>
      void navigate({
        to: ".",
        search: (current) => ({ ...current, activity: true, needsYou: undefined }),
      }),
    close: () =>
      void navigate({ to: ".", search: (current) => ({ ...current, activity: undefined }) }),
  };
}
