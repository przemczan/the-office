import { QueryClient } from "@tanstack/react-query";
import type { DaySummary } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { dayQueries, invalidateToday } from "./days.ts";

function summaryOf(day: string, today: string): DaySummary {
  return {
    day,
    today,
    initiativesDone: [],
    tasksDone: [],
    pullRequestsMerged: [],
    failedOrDropped: [],
    ideasCaptured: [],
    tasksStarted: [],
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    elsewhere: 0,
  };
}

describe("reading a day again", () => {
  it("invalidates today's queries and never a past day's", () => {
    const client = new QueryClient();
    const byKeyword = dayQueries.one(undefined, "all").queryKey;
    const byDay = dayQueries.one("2026-11-27", "all").queryKey;
    const past = dayQueries.one("2026-11-26", "all").queryKey;
    client.setQueryData(byKeyword, summaryOf("2026-11-27", "2026-11-27"));
    client.setQueryData(byDay, summaryOf("2026-11-27", "2026-11-27"));
    client.setQueryData(past, summaryOf("2026-11-26", "2026-11-27"));
    invalidateToday(client);
    expect(client.getQueryState(byKeyword)?.isInvalidated).toBe(true);
    expect(client.getQueryState(byDay)?.isInvalidated).toBe(true);
    expect(client.getQueryState(past)?.isInvalidated).toBe(false);
  });

  it("keeps the Project filter in the key, and a past day settled", () => {
    expect(dayQueries.one(undefined, ["a"]).queryKey).not.toEqual(
      dayQueries.one(undefined, "all").queryKey,
    );
    expect(dayQueries.one("2026-11-26", "all").staleTime).toBe(Infinity);
    expect(dayQueries.one(undefined, "all").refetchOnWindowFocus).toBe(true);
    expect(dayQueries.one("2026-11-26", "all").refetchOnWindowFocus).toBe(false);
  });
});
