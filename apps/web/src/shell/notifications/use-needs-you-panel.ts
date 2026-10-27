import { useNavigate, useSearch } from "@tanstack/react-router";

/** Whether the Needs you panel is open over the page, and opening and closing it. */
export interface NeedsYouPanelControls {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

/** The panel lives in the address (`?needsYou=true`), so it opens over any page, as a chat does. */
export function useNeedsYouPanel(): NeedsYouPanelControls {
  const { needsYou } = useSearch({ strict: false });
  const navigate = useNavigate();
  const go = (open: true | undefined): void =>
    void navigate({ to: ".", search: (current) => ({ ...current, needsYou: open }) });
  return {
    isOpen: needsYou === true,
    open: () => go(true),
    close: () => go(undefined),
  };
}
