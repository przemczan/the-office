import { useCallback, useSyncExternalStore } from "react";

/** Whether the system asks for reduced motion, followed as it changes. */
export function useReducedMotion(): boolean {
  return useMediaMatches("(prefers-reduced-motion: reduce)");
}

/** Whether the screen has no hover, as a phone's, where a tap must show what hovering would. */
export function useNoHover(): boolean {
  return useMediaMatches("(hover: none)");
}

function useMediaMatches(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
