import { useEffect, useRef, type RefObject } from "react";

/**
 * Scrolls the instance a link leads to (its row's `data-test-instance`, which
 * `TestTargetLaunchRow` sets) into view inside the element given the ref, once it is
 * listed there and `shown` (its fold open), and only once per instance, so a list read again or a
 * row the user scrolled past doesn't pull the page back.
 */
export function useTestInstanceIntoView(
  instanceId: string | undefined,
  shown: boolean,
): RefObject<HTMLDivElement | null> {
  const place = useRef<HTMLDivElement>(null);
  const brought = useRef<string>(undefined);
  // On every render, as the instance may be listed only once its list is read again.
  useEffect(() => {
    if (instanceId === undefined || !shown || brought.current === instanceId) return;
    // Matched by value rather than in a selector, as the id comes from the address as typed.
    const row = [
      ...(place.current?.querySelectorAll<HTMLElement>("[data-test-instance]") ?? []),
    ].find(({ dataset }) => dataset["testInstance"] === instanceId);
    if (!row) return;
    brought.current = instanceId;
    row.scrollIntoView({ block: "center" });
  });
  return place;
}
