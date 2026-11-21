import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { FireAlarmOnNow, Now, ShapingOnNow, SinceYouLeft } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { notificationEventCacheUpdates, nowQueries } from "../../api/notifications.ts";
import { FireAlarmReviewProvider } from "../../shell/fire-alarm/fire-alarm-review.tsx";
import { closePage, openPage, stubService, until } from "../../shell/page.fixtures.tsx";
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
