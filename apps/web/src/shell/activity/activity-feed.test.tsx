import { act } from "react";
import type { Activity, ActivityItem, SubjectActivity } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { closePage, openPage, stubService, until } from "../page.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../project-filter/project-filter-store.ts";
import {
  environmentCheckItem,
  failedTaskItem,
  OFF_BOARD_TASK_ID,
  offBoardTaskItem,
  subjectActivity,
  testInstanceItem,
} from "./activity.fixtures.ts";
import { ActivityFeed } from "./activity-feed.tsx";

function activityOf(
  otherWork: readonly ActivityItem[],
  activities: readonly SubjectActivity[] = [],
): Activity {
  return {
    activities: [...activities],
    otherWork: [...otherWork],
    count: activities.length + otherWork.length,
  };
}

function cards(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>("article.activity-card")];
}

function sectionTitles(page: HTMLElement): string[] {
  return [...page.querySelectorAll("section h2")].map((heading) => heading.textContent ?? "");
}

afterEach(() => {
  // While the feed still listens, so the next test starts on every Project.
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  });
  closePage();
});

describe("the Activity feed", () => {
  it("lists the activities first, then the other running work by kind, leaving out the groups with none", async () => {
    stubService({
      "GET /api/activity": () => ({
        status: 200,
        body: activityOf([failedTaskItem(), environmentCheckItem()], [subjectActivity()]),
      }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });

    await until(() => expect(cards(page)).toHaveLength(3));
    expect(sectionTitles(page)).toEqual([
      "Sessions1",
      "Off-board Tasks and environment checks1",
      "Stalled Tasks1",
    ]);
    const task = cards(page)[0];
    expect(task?.getAttribute("aria-label")).toBe("Working: Add a filter");
    expect(task?.querySelector("a")?.getAttribute("href")).toBe(
      "/tasks/3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c",
    );
    expect(task?.textContent).toContain("1 session");
    expect(task?.textContent).toMatch(/Working for /);
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
          testInstanceItem(),
          testInstanceItem({ id: "other", projectId: "p2", title: "Elsewhere" }),
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
      "GET /api/activity": () => ({ status: 200, body: activityOf([testInstanceItem()]) }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(page.textContent).toContain("Nothing is running in these Projects."));
  });
});
