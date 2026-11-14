import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NeedsYouItem, Now } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nowQueries } from "../../api/notifications.ts";
import { useNeedsYouTab } from "./needs-you-tab.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The queries tell the page of each change at once, not on a later tick, so each step renders.
notifyManager.setScheduler((notify) => notify());
// jsdom draws no images, so the favicon stays plain here and the title is what these tests read.
HTMLImageElement.prototype.decode = () => Promise.reject(new Error("jsdom draws no images"));

const TASK_ID = "6820f3e0-132c-414a-9d26-ed497c7ea9bf";
const STEADY = "(1) The Office";
const BLINK = "1 needs you";

function decision(decisionId: string): NeedsYouItem {
  return {
    kind: "decision",
    decisionId,
    taskId: TASK_ID,
    projectId: "billing",
    waitingSince: "2026-11-13T09:00:00.000Z",
  };
}
const FIRST = decision("0b6a4f1e-6a55-4c1c-9d51-2f0d5a1c7e10");
const SECOND = decision("1c7b5a2f-7b66-4d2d-8e62-3a1e6b2d8f21");

let queryClient: QueryClient;
let root: Root;
let visibility: DocumentVisibilityState;
let reducedMotion: boolean;

function NeedsYouTab(): null {
  useNeedsYouTab();
  return null;
}

function needsYou(items: readonly NeedsYouItem[]): void {
  act(() => {
    queryClient.setQueryData(nowQueries.now().queryKey, { needsYou: items } as unknown as Now);
  });
}

function showTab(shown: boolean): void {
  visibility = shown ? "visible" : "hidden";
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** The titles the tab shows over the next few seconds. */
function titlesOver(seconds: number): string[] {
  const titles = [document.title];
  for (let second = 0; second < seconds; second++) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    titles.push(document.title);
  }
  return titles;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  reducedMotion = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) => ({ matches: reducedMotion, media: query }) as MediaQueryList,
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  needsYou([]);
  root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <NeedsYouTab />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("counts Needs you in the title, and says just the Office while nothing waits", () => {
  expect(document.title).toBe("The Office");

  needsYou([FIRST, SECOND]);

  expect(document.title).toBe("(2) The Office");
});

it("blinks every second when a new item arrives while the tab is hidden", () => {
  showTab(false);
  needsYou([FIRST]);

  expect(titlesOver(3)).toEqual([STEADY, BLINK, STEADY, BLINK]);
});

it("stops blinking once the tab shows again", () => {
  showTab(false);
  needsYou([FIRST]);
  titlesOver(1);

  showTab(true);

  expect(titlesOver(2)).toEqual([STEADY, STEADY, STEADY]);
});

it("stops blinking once nothing waits", () => {
  showTab(false);
  needsYou([FIRST]);
  titlesOver(1);

  needsYou([]);

  expect(titlesOver(2)).toEqual(["The Office", "The Office", "The Office"]);
});

it("doesn't blink for an item arriving while the tab is visible", () => {
  needsYou([FIRST]);
  showTab(false);

  expect(titlesOver(2)).toEqual([STEADY, STEADY, STEADY]);
});

it("doesn't blink again for items already seen, only for a new one", () => {
  showTab(false);
  needsYou([FIRST]);
  showTab(true);
  showTab(false);
  needsYou([FIRST]);

  expect(titlesOver(1)).toEqual([STEADY, STEADY]);

  needsYou([FIRST, SECOND]);

  expect(titlesOver(1)).toEqual(["(2) The Office", "2 need you"]);
});

it("doesn't blink for what waits when the page loads", () => {
  act(() => root.unmount());
  queryClient.clear();
  showTab(false);
  needsYou([FIRST]);
  root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <NeedsYouTab />
      </QueryClientProvider>,
    ),
  );

  expect(titlesOver(2)).toEqual([STEADY, STEADY, STEADY]);
});

it("never blinks with reduced motion preferred", () => {
  reducedMotion = true;
  showTab(false);
  needsYou([FIRST]);

  expect(titlesOver(2)).toEqual([STEADY, STEADY, STEADY]);
});
