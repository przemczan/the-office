import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Activity, ActivityItem } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activityQueries } from "../../api/activity.ts";
import { subjectActivity } from "./activity.fixtures.ts";
import { ActivityFigure } from "./activity-figure.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
notifyManager.setScheduler((notify) => notify());

const openPanel = vi.fn<() => void>();
vi.mock("./use-activity-panel.ts", () => ({
  useActivityPanel: () => ({ isOpen: false, open: openPanel, close: () => undefined }),
}));

function activityOf(count: number): Activity {
  const activities = count > 0 ? [subjectActivity()] : [];
  const otherWork = Array.from({ length: Math.max(0, count - 1) }, (_, index) =>
    item(`item-${index}`),
  );
  return { activities, otherWork, count };
}

function item(id: string): ActivityItem {
  return {
    kind: "environment-check",
    id,
    projectId: "p1",
    title: "Environment check",
    since: "2026-11-22T12:00:00.000Z",
    link: { kind: "project", projectId: "p1" },
    state: "running",
  };
}

let queryClient: QueryClient;
let strip: HTMLDivElement;
let root: Root;

function shown(activity: Activity | undefined): HTMLButtonElement | null {
  if (activity) queryClient.setQueryData(activityQueries.list().queryKey, activity);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ActivityFigure />
      </QueryClientProvider>,
    ),
  );
  return strip.querySelector("button");
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise<never>(() => undefined));
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  strip = document.createElement("div");
  root = createRoot(strip);
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  openPanel.mockReset();
  vi.unstubAllGlobals();
});

it("shows nothing until Activity has been read", () => {
  expect(shown(undefined)).toBeNull();
  expect(strip.textContent).toBe("");
});

it("shows the count with a live dot while anything runs, and says it all in its name", () => {
  const figure = shown(activityOf(2));

  expect(figure?.querySelector(".live-dot")).not.toBeNull();
  expect(figure?.querySelector("b")?.textContent).toBe("2");
  expect(figure?.getAttribute("aria-label")).toBe("Activity: 1 session, 1 other running");
  expect(figure?.getAttribute("aria-haspopup")).toBe("dialog");
  expect(figure?.getAttribute("aria-expanded")).toBe("false");
});

it("has no live dot once nothing runs", () => {
  const figure = shown(activityOf(0));

  expect(figure?.querySelector(".live-dot")).toBeNull();
});

it("opens the Activity panel", () => {
  const figure = shown(activityOf(0));

  act(() => figure?.click());

  expect(openPanel).toHaveBeenCalledOnce();
});
