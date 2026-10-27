import { useEffect } from "react";
import { reportActivity } from "../api/notifications.ts";

/** Often enough against the five idle minutes that mean the user left (spec §2.7 Defaults). */
const REPORT_EVERY_MS = 60_000;

/** What the user does that counts as being at The Office, while its tab is visible. */
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "focus"] as const;

/**
 * Reports the user active while the tab is visible and used, at most once a minute, so the service
 * knows when they left and where Since you left begins.
 */
export function useReportingActivity(): void {
  useEffect(() => {
    let lastReported = Number.NEGATIVE_INFINITY;
    const report = (): void => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastReported < REPORT_EVERY_MS) return;
      lastReported = now;
      reportActivity().catch(() => {
        // The service is unreachable: the next activity tries again.
        lastReported = Number.NEGATIVE_INFINITY;
      });
    };
    report();
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, report, { passive: true });
    document.addEventListener("visibilitychange", report);
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, report);
      document.removeEventListener("visibilitychange", report);
    };
  }, []);
}
