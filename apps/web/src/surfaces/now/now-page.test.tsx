import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type {
  Decision,
  FireAlarmOnNow,
  Now,
  ShapingOnNow,
  SinceYouLeft,
  WaitingForYouItem,
} from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { notificationEventCacheUpdates, nowQueries } from "../../api/notifications.ts";
import { FireAlarmReviewProvider } from "../../shell/fire-alarm/fire-alarm-review.tsx";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
} from "../../shell/page.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../../shell/project-filter/project-filter-store.ts";
import { clockOf } from "../../shell/time.ts";
import { NowPage } from "./now-page.tsx";

const NOW: Now = {
  needsYou: [],
  waitingForYou: [],
  running: [],
  queue: [],
  shaping: [],
  tokensToday: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  desks: { inUse: 0, limit: 3 },
  usageWindows: [],
  fireAlarm: null,
};

function sinceYouLeftWith(title: string): SinceYouLeft {
  return {
    leftAt: "2026-11-13T08:00:00.000Z",
    finished: [
      {
        taskId: "3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c",
        title,
        projectId: "p1",
        outcome: "done",
        occurredAt: "2026-11-13T09:00:00.000Z",
      },
    ],
  };
}

afterEach(closePage);

describe("Now's Since you left", () => {
  it("shows the signed-in user's own, read from the service for them", async () => {
    const sent = stubService({
      "GET /api/now": () => ({ status: 200, body: NOW }),
      "GET /api/now/since-you-left": () => ({
        status: 200,
        body: sinceYouLeftWith("Add a filter"),
      }),
    });

    const { page } = await openPage("/now", { now: NowPage });

    await until(() => expect(page.textContent).toContain("Add a filter"));
    expect(page.textContent).toContain("Since you left");
    expect(sent.map(({ request }) => request)).toContain("GET /api/now/since-you-left");
  });

  it("is read again on each now.changed, which is shared by every user", async () => {
    let title = "Add a filter";
    const sent = stubService({
      "GET /api/now/since-you-left": () => ({ status: 200, body: sinceYouLeftWith(title) }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A page shows it: only a query on show is read again.
    const shown = new QueryObserver(queryClient, nowQueries.sinceYouLeft());
    const unsubscribe = shown.subscribe(() => undefined);
    await until(() =>
      expect(queryClient.getQueryData(nowQueries.sinceYouLeft().queryKey)).toBeDefined(),
    );
    title = "Fix the header";

    notificationEventCacheUpdates["now.changed"]?.(
      { type: "now.changed", occurredAt: "2026-11-13T10:00:00.000Z", now: NOW } as never,
      queryClient,
    );

    await until(() =>
      expect(queryClient.getQueryData(nowQueries.sinceYouLeft().queryKey)).toEqual(
        sinceYouLeftWith("Fix the header"),
      ),
    );
    expect(queryClient.getQueryData(nowQueries.now().queryKey)).toEqual(NOW);
    expect(sent.filter(({ request }) => request === "GET /api/now/since-you-left")).toHaveLength(2);
    unsubscribe();
  });
});

const ONBOARDING: ShapingOnNow = {
  initiativeId: "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  title: "Onboarding",
  projectIds: ["p1"],
  shapedBy: null,
  taskCount: 2,
  since: "2026-11-15T08:00:00.000Z",
};

const BILLING: ShapingOnNow = {
  initiativeId: "7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
  title: "Billing",
  projectIds: ["p2"],
  shapedBy: "product-owner",
  taskCount: 0,
  since: "2026-11-15T09:00:00.000Z",
};

function openNowWith(now: Now): Promise<{ readonly page: HTMLElement }> {
  stubService({
    "GET /api/now": () => ({ status: 200, body: now }),
    "GET /api/now/since-you-left": () => ({ status: 200, body: sinceYouLeftWith("Add a filter") }),
  });
  return openPage("/now", { now: NowPage });
}

function shapingCards(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>("[aria-label^='Shaping: ']")];
}

describe("Now's Shaping", () => {
  afterEach(() => {
    localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  });

  it("shows nothing while no Initiative is being shaped", async () => {
    const { page } = await openNowWith(NOW);

    await until(() => expect(page.textContent).toContain("Add a filter"));
    expect(page.textContent).not.toContain("Shaping");
  });

  it("shows each Initiative being shaped, with who shapes it and its Tasks so far, opening its page", async () => {
    const { page } = await openNowWith({ ...NOW, shaping: [ONBOARDING, BILLING] });

    await until(() => expect(shapingCards(page)).toHaveLength(2));
    const [onboarding, billing] = shapingCards(page);
    expect(onboarding?.textContent).toContain("Onboarding");
    expect(onboarding?.textContent).toContain("Nobody shapes Initiatives yet");
    expect(onboarding?.textContent).toContain("2 Tasks");
    expect(billing?.textContent).toContain("No Tasks yet");
    expect(billing?.textContent).toContain("product-owner");
    expect(onboarding?.querySelector("a")?.getAttribute("href")).toBe(
      `/work/initiatives/${ONBOARDING.initiativeId}`,
    );
  });

  it("is narrowed by the Project filter, noting those in other Projects", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["p1"]));
    const { page } = await openNowWith({
      ...NOW,
      shaping: [
        ONBOARDING,
        BILLING,
        { ...BILLING, initiativeId: crypto.randomUUID(), projectIds: [] },
      ],
    });
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));

    await until(() => expect(shapingCards(page)).toHaveLength(2));
    expect(shapingCards(page).map((card) => card.getAttribute("aria-label"))).toEqual([
      "Shaping: Onboarding",
      "Shaping: Billing",
    ]);
    expect(page.textContent).toContain("1 more Initiative in other Projects");
  });
});

const OFFICE_UPDATE: WaitingForYouItem = {
  kind: "office-update",
  target: {
    kind: "release",
    version: "1.4.0",
    name: "v1.4.0",
    publishedAt: "2026-11-15T08:00:00.000Z",
    url: "https://github.com/acme/the-office/releases/tag/v1.4.0",
  },
  projectIds: [],
  waitingSince: "2026-11-15T08:00:00.000Z",
};

describe("Now's Waiting for you", () => {
  it("sits under Needs you's cards, inside the Needs you panel", async () => {
    const { page } = await openNowWith({ ...NOW, waitingForYou: [OFFICE_UPDATE] });

    const panel = page.querySelector("section.panel[aria-label='Needs you']");
    await until(() =>
      expect(panel?.querySelector("section[aria-label='Waiting for you']")).not.toBeNull(),
    );
    const group = panel?.querySelector("section[aria-label='Waiting for you']");
    const feed = panel?.querySelector(".feed");
    expect(feed?.textContent).toContain("Nothing needs you. Enjoy it.");
    expect(feed?.contains(group ?? null)).toBe(false);
    expect(feed && group && feed.compareDocumentPosition(group)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(group?.textContent).toContain("Version 1.4.0 is available");
  });

  it("shows no Waiting for you group while nothing waits", async () => {
    const { page } = await openNowWith(NOW);

    await until(() => expect(page.textContent).toContain("Nothing needs you. Enjoy it."));
    expect(page.querySelector("section[aria-label='Waiting for you']")).toBeNull();
  });
});

const SINCE = "2026-11-21T14:02:00.000Z";

function alarmIn(way: FireAlarmOnNow["way"]): FireAlarmOnNow {
  return {
    since: SINCE,
    way,
    stopping: false,
    paused: [
      {
        taskId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        title: "Fix the header",
        projectId: "p1",
        stage: null,
        resume: {
          kind: "fresh",
          stageName: "Build",
          contextTokens: 0,
          briefTokens: 2000,
          tokens: 2000,
        },
      },
    ],
    goingOn: [
      {
        taskId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
        title: "Add a footer",
        projectId: "p1",
        stage: { key: "build", name: "Build", role: null, since: SINCE },
      },
    ],
    resumeTokens: 2000,
  };
}

function openAlarmWith(fireAlarm: FireAlarmOnNow): Promise<{ readonly page: HTMLElement }> {
  stubService({
    "GET /api/now": () => ({ status: 200, body: { ...NOW, fireAlarm } }),
    "GET /api/now/since-you-left": () => ({ status: 200, body: sinceYouLeftWith("Add a filter") }),
  });
  return openPage("/now", {
    now: () => (
      <FireAlarmReviewProvider>
        <NowPage />
      </FireAlarmReviewProvider>
    ),
  });
}

function alarmPanel(page: HTMLElement): HTMLElement {
  const panel = page.querySelector<HTMLElement>("[aria-label='Fire alarm']");
  if (!panel) throw new Error("There is no alarm panel.");
  return panel;
}

describe("Now's fire alarm", () => {
  it("names the way after the current Stages, with each Task going on to the end of its Stage", async () => {
    const { page } = await openAlarmWith(alarmIn("after-stages"));

    await until(() => expect(page.textContent).toContain("Add a footer"));
    const panel = alarmPanel(page);
    expect(panel.textContent).toContain(
      `Alarm on since ${clockOf(SINCE)} · stopping after the current Stages`,
    );
    expect(panel.textContent).toContain("Fix the header");
    expect(panel.textContent).toContain("Stopped");
    expect(panel.textContent).toContain("Stopping after its Stage");
  });

  it("names the way after the current Tasks, with each started Task finishing", async () => {
    const { page } = await openAlarmWith(alarmIn("after-tasks"));

    await until(() => expect(page.textContent).toContain("Add a footer"));
    const panel = alarmPanel(page);
    expect(panel.textContent).toContain(
      `Alarm on since ${clockOf(SINCE)} · finishing the current Tasks`,
    );
    expect(panel.textContent).toContain("Finishing its Task");
  });

  it("keeps today's line under ASAP, listing nothing as going on", async () => {
    const { page } = await openAlarmWith(alarmIn("asap"));

    await until(() => expect(page.textContent).toContain("Fix the header"));
    const panel = alarmPanel(page);
    expect(panel.querySelector("h2")?.textContent).toBe(`Alarm on since ${clockOf(SINCE)}`);
    expect(panel.textContent).not.toContain("Add a footer");
  });
});

const ONBOARD_TASK_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const DECISION_ID = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

const OUT_OF_TRIES: Decision = {
  id: DECISION_ID,
  threadId: "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
  inStageThread: true,
  kind: "form",
  taskId: ONBOARD_TASK_ID,
  roleKey: null,
  context: "Verify failed.",
  questions: [
    {
      kind: "choice",
      question: "Verify is out of tries. What now?",
      options: ["Retry", "Continue with the issues", "Drop"],
      recommendation: { option: 0, reason: "It may pass now." },
    },
  ],
  attachmentIds: [],
  askedAt: "2026-11-22T10:00:00.000Z",
  putTo: null,
  passedOn: [],
  formAnswer: null,
  answeredAt: null,
  closedAt: null,
  closedBecause: null,
  answeredByUser: null,
  answeredBy: null,
  atUsersRequest: null,
  fields: null,
  answeredByTheOffice: false,
};

const FAILED_ONBOARD: Now["needsYou"][number] = {
  kind: "decision",
  decisionId: DECISION_ID,
  taskId: ONBOARD_TASK_ID,
  projectId: "p1",
  waitingSince: "2026-11-22T10:00:00.000Z",
  offBoardTask: {
    kind: "onboard",
    title: "Onboard",
    stageName: "Verify",
    error: "npm test exited 1: 3 of 214 tests failed",
  },
};

describe("Now's Off-board Tasks", () => {
  it("shows an Off-board Task's out-of-tries Decision as its failed card, Retry answering its first option", async () => {
    const sent = stubService({
      "GET /api/now": () => ({ status: 200, body: { ...NOW, needsYou: [FAILED_ONBOARD] } }),
      "GET /api/now/since-you-left": () => ({
        status: 200,
        body: sinceYouLeftWith("Add a filter"),
      }),
      "GET /api/decisions/open": () => ({ status: 200, body: [OUT_OF_TRIES] }),
      [`POST /api/decisions/${DECISION_ID}/answer`]: () => ({ status: 200, body: {} }),
    });
    const { page } = await openPage("/now", { now: NowPage });

    const card = (): Element | null =>
      page.querySelector("[aria-label='Off-board Task failed: Onboard']");
    await until(() => expect(buttonNamed(card() ?? page, "Retry")?.disabled).toBe(false));
    expect(card()?.textContent).toContain("Verify failed, and its rounds are used up.");
    expect(card()?.textContent).toContain("npm test exited 1: 3 of 214 tests failed");
    const links = [...(card()?.querySelectorAll("a") ?? [])].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(links).toContainEqual(["Onboard", `/tasks/${ONBOARD_TASK_ID}`]);
    expect(links).toContainEqual([
      "Open the Decision",
      `/tasks/${ONBOARD_TASK_ID}?decision=${DECISION_ID}`,
    ]);

    act(() => buttonNamed(card() ?? page, "Retry")?.click());

    await until(() =>
      expect(sent).toContainEqual({
        request: `POST /api/decisions/${DECISION_ID}/answer`,
        body: { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
      }),
    );
  });

  it("marks an Off-board Task in Running and in the Queue with its badge, and no other Task", async () => {
    const { page } = await openNowWith({
      ...NOW,
      running: [
        {
          taskId: crypto.randomUUID(),
          title: "Set up the run environment",
          projectId: "p1",
          state: "in-progress",
          pausedBy: null,
          resumesAt: null,
          stage: null,
          madeFor: "run-environment-setup",
        },
        {
          taskId: crypto.randomUUID(),
          title: "Add offline sync",
          projectId: "p1",
          state: "in-progress",
          pausedBy: null,
          resumesAt: null,
          stage: null,
          madeFor: null,
        },
      ],
      queue: [
        {
          taskId: crypto.randomUUID(),
          title: "Onboard",
          projectId: "p2",
          madeFor: "onboard",
          place: 1,
          reasons: ["The Project limit is reached: 1 of its Tasks is running."],
          shortReasons: ["Project limit reached (1)"],
        },
      ],
    });

    const badged = (label: string): boolean | undefined =>
      page.querySelector(`[aria-label='${label}']`)?.textContent?.includes("Off-board Task");
    await until(() => expect(badged("Running: Set up the run environment")).toBe(true));
    expect(badged("Running: Add offline sync")).toBe(false);
    expect(badged("Queued: Onboard")).toBe(true);
  });
});

const QUEUED_TASK_ID = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";

function queuedRow(page: HTMLElement, title: string): HTMLElement | null {
  return page.querySelector<HTMLElement>(`[aria-label='Queued: ${title}']`);
}

describe("Now's Queue", () => {
  it("shows a queued Task as one row: place, title link, Project, short reasons and estimate", async () => {
    stubService({
      "GET /api/now": () => ({
        status: 200,
        body: {
          ...NOW,
          queue: [
            {
              taskId: QUEUED_TASK_ID,
              title: "Add offline sync",
              projectId: "p1",
              madeFor: null,
              place: 2,
              reasons: [
                "The Office-wide limit is reached: all 3 desks are in use.",
                "The Project limit is reached: 1 of its Tasks is running.",
              ],
              shortReasons: ["Office-wide limit reached (3)"],
            },
          ],
        },
      }),
      "GET /api/now/since-you-left": () => ({ status: 200, body: sinceYouLeftWith("Fix it") }),
      "GET /api/usage-estimates": () => ({
        status: 200,
        body: [
          {
            taskId: QUEUED_TASK_ID,
            usageEstimate: {
              basis: { source: "planner" },
              engines: [{ engineId: "claude-code", tokens: 60_000 }],
            },
          },
        ],
      }),
    });
    const { page } = await openPage("/now", { now: NowPage });

    await until(() => expect(queuedRow(page, "Add offline sync")).not.toBeNull());
    const row = queuedRow(page, "Add offline sync");
    await until(() => expect(row?.querySelector("[aria-label='Usage estimate']")).not.toBeNull());
    expect(row?.textContent).toContain("Place 2");
    expect(row?.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${QUEUED_TASK_ID}`);
    expect(row?.querySelector("a")?.getAttribute("title")).toBe("Add offline sync");
    // A missing short reason falls back to its full one.
    expect(row?.querySelector(".now-queued-reasons")?.textContent).toBe(
      "Office-wide limit reached (3) · The Project limit is reached: 1 of its Tasks is running.",
    );
    expect(row?.textContent).not.toContain("Queued");
    expect(row?.textContent).not.toContain("Off-board Task");
  });

  it("shows no reasons nor separator for a queued Task with no reasons and no estimate", async () => {
    const { page } = await openNowWith({
      ...NOW,
      queue: [
        {
          taskId: QUEUED_TASK_ID,
          title: "Add offline sync",
          projectId: "p1",
          madeFor: null,
          place: 1,
          reasons: [],
          shortReasons: [],
        },
      ],
    });

    await until(() => expect(queuedRow(page, "Add offline sync")).not.toBeNull());
    const row = queuedRow(page, "Add offline sync");
    expect(row?.querySelector(".now-queued-reasons")).toBeNull();
    expect(row?.querySelector("[aria-label='Usage estimate']")).toBeNull();
    expect(row?.textContent).not.toContain("·");
  });
});
