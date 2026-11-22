import { useNavigate, useSearch } from "@tanstack/react-router";

/** Whether the Needs you panel is open over the page, and opening and closing it. */
export interface NeedsYouPanelControls {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

/**
 * The panel lives in the address (`?needsYou=true`), so it opens over any page; opening it takes
 * the Activity panel's place, as the two lie over the page in the same spot.
 */
export function useNeedsYouPanel(): NeedsYouPanelControls {
  const { needsYou } = useSearch({ strict: false });
  const navigate = useNavigate();
  return {
    isOpen: needsYou === true,
    open: () =>
      void navigate({
        to: ".",
        search: (current) => ({ ...current, needsYou: true, activity: undefined }),
      }),
    close: () =>
      void navigate({ to: ".", search: (current) => ({ ...current, needsYou: undefined }) }),
  };
}
