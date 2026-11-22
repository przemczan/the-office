import { focusManager } from "@tanstack/react-query";
import type { Activity, ActivityItem } from "@the-office/contracts";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePage, openPage, stubService, until } from "../page.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../project-filter/project-filter-store.ts";
import {
  environmentCheckItem,
  failedTaskItem,
  OFF_BOARD_TASK_ID,
  offBoardTaskItem,
  taskItem,
} from "./activity.fixtures.ts";
import { ActivityFeed } from "./activity-feed.tsx";
import { SEEN_AFTER_MS } from "./use-marking-seen.ts";

/** The feed's IntersectionObserver: what it calls, and the cards it watches. */
let viewChanged: IntersectionObserverCallback;
const watchedCards = new Set<Element>();

function bringCardsIntoView(): void {
  act(() =>
    viewChanged(
      [...watchedCards].map(
        (target) => ({ target, isIntersecting: true, intersectionRatio: 1 }) as never,
      ),
      {} as IntersectionObserver,
    ),
  );
}

function activityOf(items: readonly ActivityItem[]): Activity {
  return { items: [...items], count: items.length };
}

function cards(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>("article.activity-card")];
}

function sectionTitles(page: HTMLElement): string[] {
  return [...page.querySelectorAll("section h2")].map((heading) => heading.textContent ?? "");
}

async function waitOutTheSecond(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, SEEN_AFTER_MS + 100)));
}

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        viewChanged = callback;
      }
      observe(card: Element): void {
        watchedCards.add(card);
      }
      unobserve(card: Element): void {
        watchedCards.delete(card);
      }
      disconnect(): void {
        watchedCards.clear();
      }
    },
  );
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => {
  // While the feed still listens, so the next test starts on every Project.
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  });
  closePage();
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
});

describe("the Activity feed", () => {
  it("groups the items by kind, leaving out the groups with none", async () => {
    stubService({
      "GET /api/activity": () => ({
        status: 200,
        body: activityOf([failedTaskItem(), taskItem(), environmentCheckItem()]),
      }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });

    await until(() => expect(cards(page)).toHaveLength(3));
    expect(sectionTitles(page)).toEqual([
      "Tasks1",
      "Off-board Tasks and environment checks1",
      "Stalled Tasks1",
    ]);
    const task = cards(page)[0];
    expect(task?.getAttribute("aria-label")).toBe("In progress: Add a filter");
    expect(task?.querySelector("a")?.getAttribute("href")).toBe(
      "/tasks/3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c",
    );
    expect(task?.textContent).toContain("In progress for ");
  });

  it("shows an Off-board Task by its kind, with its Stage and tokens, leading to its Task", async () => {
    stubService({
      "GET /api/activity": () => ({
        status: 200,
        body: activityOf([
          offBoardTaskItem({
            kind: "run-environment-set-up",
            title: "Set up the run environment",
            stageName: "Set up",
          }),
        ]),
      }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });

    await until(() => expect(cards(page)).toHaveLength(1));
    expect(sectionTitles(page)).toEqual(["Off-board Tasks and environment checks1"]);
    const card = cards(page)[0];
    expect(card?.getAttribute("aria-label")).toBe("Running: Set up the run environment");
    expect(card?.textContent).toContain("Run environment set-up");
    expect(card?.textContent).toContain("Set up · 212k tokens");
    expect(card?.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${OFF_BOARD_TASK_ID}`);
  });

  it("follows the Project filter, counting what it leaves out", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["p1"]));
    stubService({
      "GET /api/activity": () => ({
        status: 200,
        body: activityOf([
          taskItem(),
          taskItem({ id: "other", projectId: "p2", title: "Elsewhere" }),
        ]),
      }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(cards(page)).toHaveLength(1));
    expect(page.textContent).not.toContain("Elsewhere");
    expect(page.textContent).toContain("1 more item in other Projects");
  });

  it("says nothing is running in these Projects when the filter leaves everything out", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["p2"]));
    stubService({
      "GET /api/activity": () => ({ status: 200, body: activityOf([taskItem()]) }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(page.textContent).toContain("Nothing is running in these Projects."));
  });

  it("marks an ended item New until its card has been in view for a second, then keeps it after a re-read", async () => {
    const check = environmentCheckItem();
    let listed: readonly ActivityItem[] = [taskItem(), check];
    const sent = stubService({
      "GET /api/activity": () => ({ status: 200, body: activityOf(listed) }),
      "POST /api/activity/seen": () => ({ status: 204 }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });

    await until(() => expect(page.querySelectorAll(".activity-card.unseen")).toHaveLength(1));
    const unseen = page.querySelector(".activity-card.unseen");
    expect(unseen?.getAttribute("aria-label")).toBe("Failed: Environment check");
    expect(unseen?.textContent).toContain("New");
    expect(watchedCards.size).toBe(1);

    bringCardsIntoView();
    await waitOutTheSecond();

    await until(() =>
      expect(sent.filter(({ request }) => request === "POST /api/activity/seen")).toEqual([
        { request: "POST /api/activity/seen", body: { itemIds: [check.id] } },
      ]),
    );
    expect(page.querySelectorAll(".activity-card.unseen")).toHaveLength(0);

    // The service no longer lists what was seen; the feed keeps it while the panel stays open.
    listed = [taskItem()];
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await until(() =>
      expect(sent.filter(({ request }) => request === "GET /api/activity")).toHaveLength(2),
    );
    expect(cards(page).map((card) => card.getAttribute("aria-label"))).toEqual([
      "In progress: Add a filter",
      "Failed: Environment check",
    ]);
    expect(page.textContent).not.toContain("New");
  });
});
