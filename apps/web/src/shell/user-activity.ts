import { useLocation } from "@tanstack/react-router";
import type { UserActivityReport } from "@the-office/contracts";
import { useEffect, useRef } from "react";
import { reportActivity } from "../api/notifications.ts";

/** Often enough against the five idle minutes that mean the user left (spec §2.7 Defaults). */
const REPORT_EVERY_MS = 60_000;

/** What the user does that counts as being at The Office, while its tab is visible. */
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "focus"] as const;

const TASK_PAGE = /^\/tasks\/([^/]+)/;
const INITIATIVE_PAGE = /^\/work\/initiatives\/([^/]+)/;
const TEST_TARGETS_PAGE = /^\/projects\/([^/]+)\/test-targets\/?$/;
const ACTION_HISTORY_PAGE = /^\/projects\/([^/]+)\/actions\/([^/]+)\/?$/;

/**
 * The page at a path, as far as Notifications care: Now, a Task's or an Initiative's page, a
 * Project's Test targets or an Action's History, Settings › Updates, or another.
 */
export function pageAt(pathname: string): UserActivityReport["page"] {
  if (pathname === "/now") return { kind: "now" };
  if (pathname === "/settings/updates") return { kind: "office-update" };
  const taskId = TASK_PAGE.exec(pathname)?.[1];
  if (taskId) return { kind: "task", taskId };
  const initiativeId = INITIATIVE_PAGE.exec(pathname)?.[1];
  if (initiativeId) return { kind: "initiative", initiativeId };
  const history = ACTION_HISTORY_PAGE.exec(pathname);
  if (history?.[1] && history[2]) {
    return {
      kind: "action-history",
      projectId: decodeURIComponent(history[1]),
      actionKey: decodeURIComponent(history[2]),
    };
  }
  const projectId = TEST_TARGETS_PAGE.exec(pathname)?.[1];
  return projectId
    ? { kind: "test-instances", projectId: decodeURIComponent(projectId) }
    : { kind: "elsewhere" };
}

/**
 * Reports the user active while the tab is visible and used, or focused, at most once a minute,
 * and at once on opening another page: the service learns when they left, what they opened, and
 * holds phone pushes while The Office is focused (spec §2.7).
 */
export function useReportingActivity(): void {
  const pathname = useLocation({ select: (location) => location.pathname });
  const page = useRef(pageAt(pathname));
  const lastReported = useRef(Number.NEGATIVE_INFINITY);
  const report = useRef((force: boolean): void => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (!force && now - lastReported.current < REPORT_EVERY_MS) return;
    lastReported.current = now;
    reportActivity({ page: page.current }).catch(() => {
      // The service is unreachable: the next activity tries again.
      lastReported.current = Number.NEGATIVE_INFINITY;
    });
  });

  useEffect(() => {
    page.current = pageAt(pathname);
    report.current(true);
  }, [pathname]);

  useEffect(() => {
    const onActivity = (): void => report.current(false);
    for (const type of ACTIVITY_EVENTS)
      window.addEventListener(type, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onActivity);
    // A focused tab counts as being at the desk though nothing moves, as when reading.
    const whileFocused = window.setInterval(() => {
      if (document.hasFocus()) report.current(false);
    }, REPORT_EVERY_MS);
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity);
      document.removeEventListener("visibilitychange", onActivity);
      window.clearInterval(whileFocused);
    };
  }, []);
}
