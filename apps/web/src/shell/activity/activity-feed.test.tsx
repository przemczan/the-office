import { act } from "react";
import type { Activity, ActivityItem, SubjectActivity } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { closePage, openPage, stubService, until } from "../page.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../project-filter/project-filter-store.ts";
import {
  environmentCheckItem,
  failedTaskItem,
  INITIATIVE_ID,
  OFF_BOARD_TASK_ID,
  offBoardTaskItem,
  sessionOf,
  subjectActivity,
  testInstanceItem,
} from "./activity.fixtures.ts";
import { ActivityFeed } from "./activity-feed.tsx";
import { ACTIVITY_GROUPING_STORAGE_KEY } from "./activity-grouping-store.ts";

const CHAT_ID = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

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
  localStorage.removeItem(ACTIVITY_GROUPING_STORAGE_KEY);
  // While the feed still listens, so the next test starts on every Project.
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  });
  closePage();
});

describe("the Activity feed", () => {
  it("lists the sessions first, then the other running work by kind, leaving out the groups with none", async () => {
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
    expect(page.querySelector(".activity-other-work")?.tagName).toBe("H2");
    expect(page.querySelector(".activity-other-work")?.textContent).toBe("Other running work");
    const task = cards(page)[0];
    expect(task?.getAttribute("aria-label")).toBe("Working: Add a filter");
    expect(task?.querySelector("a")?.getAttribute("href")).toBe(
      "/tasks/3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c",
    );
    expect(task?.textContent).toContain("Implement");
    expect(task?.textContent).toMatch(/Working for /);
  });

  it("groups by person by default, each person with their activities, and By subject lists the people on each", async () => {
    stubService({
      "GET /api/activity": () => ({
        status: 200,
        body: activityOf(
          [],
          [
            subjectActivity({
              sessions: [
                sessionOf({ person: { kind: "person", roleKey: "developer" } }),
                sessionOf({
                  person: { kind: "person", roleKey: "reviewer" },
                  state: "waiting",
                  stageName: "Review",
                  waitingOn: { kind: "decision", question: "Ship it?" },
                }),
              ],
            }),
          ],
        ),
      }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });

    await until(() => expect(page.querySelectorAll(".activity-person")).toHaveLength(2));
    expect(cards(page)).toHaveLength(2);
    expect(page.textContent).toContain("Waiting on you");
    expect(page.textContent).toContain("Ship it?");

    const bySubject = [...page.querySelectorAll("button")].find(
      (button) => button.textContent === "By subject",
    );
    act(() => bySubject?.click());

    await until(() => expect(cards(page)).toHaveLength(1));
    expect(page.querySelectorAll(".activity-person")).toHaveLength(0);
    expect(page.querySelectorAll(".activity-session")).toHaveLength(2);
    expect(localStorage.getItem(ACTIVITY_GROUPING_STORAGE_KEY)).toBe('"subject"');
  });

  it("links an Initiative to its page and a chat to the chat drawer, with no Project chip", async () => {
    stubService({
      "GET /api/activity": () => ({
        status: 200,
        body: activityOf(
          [],
          [
            subjectActivity({
              id: `initiative:${INITIATIVE_ID}`,
              subject: { kind: "initiative", initiativeId: INITIATIVE_ID, title: "Revamp" },
              link: { kind: "initiative", initiativeId: INITIATIVE_ID },
              sessions: [sessionOf({ sessionKind: "thread", stageName: null })],
            }),
            subjectActivity({
              id: `chat:${CHAT_ID}`,
              subject: { kind: "chat", threadId: CHAT_ID, roleKey: "planner", title: "A chat" },
              link: { kind: "chat", roleKey: "planner", threadId: CHAT_ID },
              sessions: [sessionOf({ sessionKind: "chat", stageName: null })],
            }),
          ],
        ),
      }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });

    await until(() => expect(cards(page)).toHaveLength(2));
    const hrefs = cards(page).map((card) => card.querySelector("a")?.getAttribute("href"));
    expect(hrefs).toEqual([
      `/work/initiatives/${INITIATIVE_ID}`,
      `/now?chat=planner&thread=${CHAT_ID}`,
    ]);
    expect(page.textContent).toContain("Planning");
    expect(page.textContent).toContain("Chat");
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

  it("keeps an Initiative's activity whatever the Project filter, and filters a Task's", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["p2"]));
    stubService({
      "GET /api/activity": () => ({
        status: 200,
        body: activityOf(
          [],
          [
            subjectActivity(),
            subjectActivity({
              id: "initiative:1",
              subject: { kind: "initiative", initiativeId: INITIATIVE_ID, title: "Revamp" },
              link: { kind: "initiative", initiativeId: INITIATIVE_ID },
            }),
          ],
        ),
      }),
    });

    const { page } = await openPage("/now", { now: ActivityFeed });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(cards(page)).toHaveLength(1));
    expect(page.textContent).toContain("Revamp");
    expect(page.textContent).not.toContain("Add a filter");
    expect(page.textContent).toContain("1 more item in other Projects");
  });

  it("says what shows here when nothing is running", async () => {
    stubService({ "GET /api/activity": () => ({ status: 200, body: activityOf([]) }) });

    const { page } = await openPage("/now", { now: ActivityFeed });

    await until(() => expect(page.textContent).toContain("Nothing is running."));
    expect(page.textContent).toContain("Sessions, test instances, CI runs");
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
