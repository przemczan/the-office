import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Now, SinceYouLeft } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { notificationEventCacheUpdates, nowQueries } from "../../api/notifications.ts";
import { closePage, openPage, stubService, until } from "../../shell/page.fixtures.tsx";
import { NowPage } from "./now-page.tsx";

const NOW: Now = {
  needsYou: [],
  running: [],
  queue: [],
  tokensToday: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  tasksTouched: 0,
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
