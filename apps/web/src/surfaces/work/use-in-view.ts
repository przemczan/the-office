import { useEffect, useState } from "react";

/** Whether any of the element shows in the window, scrolling parents' clipping included. */
export function useInView(element: Element | null): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    if (element === null) return;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries.at(-1);
      if (latest) setInView(latest.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return inView;
}
