import type {
  SystemHealth,
  SystemHealthPoint,
  SystemHealthRead,
  SystemHealthSlowestRoute,
  TelemetrySettings,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { statsQueries } from "../../api/telemetry.ts";
import {
  closePage,
  openPage,
  stubService,
  until,
  type Answers,
} from "../../shell/page.fixtures.tsx";
import { PageHeadingProvider, type PageHeading } from "../../shell/page-heading.tsx";
import { StatsPage } from "./stats-page.tsx";
import { SystemHealthPage } from "./system-health.tsx";

// jsdom has no layout, so a Tooltip never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const TO = Date.parse("2026-11-17T14:05:00.000Z");
const FROM = TO - 60 * 60 * 1000;
/** The Office started 2.5 minutes before the hour ends, so the time before is hatched. */
const SINCE = TO - 150 * 1000;

/** One reading every 5 s since the start, with a slow spell of 842 ms at the 10th. */
const POINTS: SystemHealthPoint[] = Array.from({ length: 30 }, (_, index) => ({
  at: new Date(SINCE + (index + 1) * 5000).toISOString(),
  eventLoopLagP99Ms: index === 29 ? 9.1 : 6,
  eventLoopLagMaxMs: index === 9 ? 842 : 12,
  officeCpuPercent: index === 29 ? 23 : 18,
  officeCpuOfWorkstationPercent: index === 29 ? 1.4 : 1.1,
  memoryInUseBytes: 372 * 1024 * 1024,
  heapUsedBytes: 180 * 1024 * 1024,
  workstationCpuPercent: 31,
  workstationMemoryPercent: 58,
  requestsPerMinute: 310,
  requestP95Ms: 46,
  queriesPerMinute: 650,
  queryP95Ms: 9.8,
  connectionsWaiting: index === 9 ? 7 : 0,
}));

/** A shape well past 200 characters, its WHERE at the end, as Drizzle's SELECTs list every column. */
const LONG_SHAPE = `SELECT ${Array.from({ length: 30 }, (_, index) => `"stage_runs"."column_${index}"`).join(", ")} FROM stage_runs WHERE task_id = ?`;

const route = (
  method: string,
  template: string,
  count: number,
  totalMs: number,
): SystemHealthSlowestRoute => ({
  route: { method, template },
  count,
  p95Ms: totalMs / count,
  maxMs: (totalMs / count) * 2,
  totalMs,
});

/** 14 routes, the stage runs' first by total time, the most requested last but one. */
const ROUTES: SystemHealthSlowestRoute[] = [
  route("GET", "/api/tasks/:id/stage-runs", 412, 251_000),
  ...Array.from({ length: 11 }, (_, index) =>
    route("GET", `/api/route-${index + 1}`, 10 + index, 20_000 - index * 1000),
  ),
  route("GET", "/api/tasks", 1184, 4_000),
  { route: null, count: 14, p95Ms: 2, maxMs: 8, totalMs: 21 },
];

const HOUR: SystemHealthRead = {
  state: "read",
  from: new Date(FROM).toISOString(),
  to: new Date(TO).toISOString(),
  stepSeconds: 5,
  readingsSince: new Date(SINCE).toISOString(),
  points: POINTS,
  requests: 18_400,
  requestP95Ms: 46,
  queries: 39_200,
  queryP95Ms: 9.8,
  slowestRoutes: ROUTES,
  slowestQueries: [
    {
      operation: "SELECT",
      table: "stage_runs",
      shape: LONG_SHAPE,
      calledFrom: [
        "apps/service/src/modules/pipelines/adapters/drizzle-stage-runs.ts:88 (DrizzleStageRuns.ofTask)",
        "apps/service/src/modules/work/application/task-page.ts:41 (TaskPage.read)",
      ],
      count: 412,
      p95Ms: 1480,
      maxMs: 2210,
      totalMs: 230_000,
    },
    {
      operation: "INSERT",
      table: "process_output",
      shape: "INSERT INTO process_output (id, chunk) VALUES (?)",
      calledFrom: [],
      count: 18_400,
      p95Ms: 4.2,
      maxMs: 160,
      totalMs: 25_000,
    },
  ],
  unansweredBlocks: [],
};

const LOAD_NOW = { sessionsRunning: 4, stageRunsRunning: 2, browserConnectionsOpen: 3 };

const HEALTH: SystemHealth = { range: "1h", loadNow: LOAD_NOW, readings: HOUR };

const OFF: TelemetrySettings = {
  saved: { kind: "off" },
  running: { kind: "off" },
  setByEnvironment: false,
  appliesAtNextStart: false,
  bundledGrafana: { state: "not-wanted", address: "http://localhost:3300", earlierStopped: [] },
};

let heading: PageHeading | undefined;

const framed = (page: ReactNode) => (): ReactNode => (
  <PageHeadingProvider
    setPageHeading={(next) => {
      heading = typeof next === "function" ? next(heading) : next;
    }}
  >
    {page}
  </PageHeadingProvider>
);

const pages = {
  stats: framed(<StatsPage />),
  "stats/system-health": framed(<SystemHealthPage />),
};

function openHealth(answers: Answers = {}, path = "/stats/system-health") {
  const sent = stubService({
    "GET /api/stats/system-health?range=1h": () => ({ status: 200, body: HEALTH }),
    "GET /api/settings/telemetry": () => ({ status: 200, body: OFF }),
    "GET /api/stats/basic": () => ({ status: 404 }),
    "GET /api/stats/full?range=7d&split=model": () => ({ status: 200, body: { state: "not-on" } }),
    ...answers,
  });
  return { sent, opened: openPage(path, pages) };
}

function block(page: HTMLElement, name: string): HTMLElement {
  const found = [...page.querySelectorAll<HTMLElement>("section[aria-labelledby]")].find(
    (section) => section.querySelector("h3")?.textContent === name,
  );
  if (!found) throw new Error(`No block ${name}.`);
  return found;
}

/** The button named `name`; never cloned, as the segmented controls' inline styles break jsdom. */
function button(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) =>
      (each.getAttribute("aria-label") ??
        [...each.childNodes]
          .filter((node) => node.nodeName !== "STYLE")
          .map((node) => node.textContent)
          .join("")
          .trim()) === name,
  );
  if (!found) throw new Error(`No button ${name}.`);
  return found;
}

function rangeTab(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [
    ...(page
      .querySelector("[role='group'][aria-label='Range']")
      ?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []),
  ].find((each) => each.textContent === name);
  if (!found) throw new Error(`No range ${name}.`);
  return found;
}

function statsTab(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("[role='tablist'] [role='tab']")].find(
    (each) => each.textContent === name,
  );
  if (!found) throw new Error(`No tab ${name}.`);
  return found;
}

function tipShown(): string {
  return document.querySelector("[role='tooltip']")?.textContent ?? "";
}

afterEach(() => {
  closePage();
  heading = undefined;
});

describe("System health", () => {
  it("shows Load now and the four blocks from the last hour's Health readings", async () => {
    const { sent, opened } = openHealth();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Sessions running"));

    expect(heading).toEqual({ title: "Stats", crumb: "System health", parent: undefined });
    expect(statsTab(page, "System health").getAttribute("aria-selected")).toBe("true");
    expect(sent.map(({ request }) => request)).toContain("GET /api/stats/system-health?range=1h");
    const headings = [...page.querySelectorAll("section[aria-labelledby] h3")].map(
      (each) => each.textContent,
    );
    expect(headings).toEqual([
      "Load now",
      "Responsiveness",
      "CPU and memory",
      "Requests",
      "Database",
    ]);
    for (const name of headings) {
      expect(block(page, name ?? "").textContent).toContain("Office-wide");
    }

    const loadNow = block(page, "Load now");
    expect(loadNow.textContent).toContain("the same on every range");
    expect(loadNow.textContent).toContain("4Sessions running");
    expect(loadNow.textContent).toContain("2Stage runs running");
    expect(loadNow.textContent).toContain("3Browser connections open");

    const source = page.querySelector(".stats-source")?.textContent ?? "";
    expect(source).toContain("From The Office's own Health readings: one every 5 seconds since it");
    expect(source).toContain("kept in memory for an hour.");
    expect(source).toMatch(/Updated \d\d:\d\d:\d\d · every 5 seconds/);
    expect(page.querySelector(".stats-live-dot")).not.toBeNull();

    const responsiveness = block(page, "Responsiveness");
    expect(responsiveness.textContent).toContain("9.1 ms p99 now · the longest wait 842 ms at");
    expect(responsiveness.querySelector(".stats-tone-text-warning")).not.toBeNull();
    expect(responsiveness.textContent).toContain("100 ms: answers feel late");
    expect(responsiveness.textContent).toContain("Before this start");

    const cpu = block(page, "CPU and memory");
    expect(cpu.textContent).toContain("now 23% of one core");
    expect(cpu.textContent).toContain("now 372 MB");
    expect(cpu.textContent).toContain("In use");
    expect(cpu.textContent).toContain("Heap used");

    expect(block(page, "Requests").textContent).toContain(
      "18.4k requests in the last hour · p95 46 ms",
    );
    const database = block(page, "Database");
    expect(database.textContent).toContain(
      "39.2k queries in the last hour · p95 9.8 ms · up to 7 queries waited for a connection",
    );
    expect(database.textContent).toContain("Statement shape");
    expect(database.textContent).toContain(LONG_SHAPE);
    expect(database.textContent).toContain(
      "Each shape names up to 3 places in The Office's code it was run from.",
    );
    expect(database.textContent).toContain("The Office keeps the 500 shapes seen most.");
  });

  it("unfolds a slowest query to its whole shape, Copy and where in the code it was run from", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      const { opened } = openHealth();
      const { page } = await opened;
      await until(() => expect(page.textContent).toContain("Slowest queries"));
      const database = block(page, "Database");
      const slowest = database.querySelector("tbody tr");
      const folds = [...database.querySelectorAll("tbody button.stats-fold")];
      expect(folds.map((fold) => fold.getAttribute("aria-label"))).toEqual([
        "The whole statement shape",
        "The whole statement shape",
      ]);
      const [fold, otherFold] = folds;
      expect(fold?.getAttribute("aria-expanded")).toBe("false");
      expect(slowest?.querySelector(".stats-slowest-clamp")?.textContent).toBe(LONG_SHAPE);
      expect(database.textContent).not.toContain("Called from");

      act(() => (fold as HTMLButtonElement).click());
      expect(fold?.getAttribute("aria-expanded")).toBe("true");
      expect(slowest?.querySelector(".stats-slowest-clamp")).toBeNull();
      expect(slowest?.querySelector("th")?.textContent).toBe(LONG_SHAPE);
      const unfolded = document.getElementById(fold?.getAttribute("aria-controls") ?? "");
      expect(unfolded?.textContent).toContain("Called from");
      expect(
        [...(unfolded?.querySelectorAll("li code") ?? [])].map((site) => site.textContent),
      ).toEqual(HOUR.slowestQueries[0]?.calledFrom);

      await act(async () => button(unfolded ?? database, "Copy").click());
      expect(writeText).toHaveBeenCalledWith(LONG_SHAPE);

      act(() => (otherFold as HTMLButtonElement).click());
      expect(database.textContent).toContain("Called from: not found in The Office's code");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("sorts the slowest routes by total time, each figure column a sort, and shows them all", async () => {
    const { opened } = openHealth();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Slowest routes"));
    const requests = block(page, "Requests");
    const rows = () => [...requests.querySelectorAll("tbody tr")];

    expect(rows()).toHaveLength(10);
    expect(rows()[0]?.textContent).toContain("GET/api/tasks/:id/stage-runs");
    // 251 s of 420 s in all.
    expect(rows()[0]?.textContent).toContain("4 min 11 s 60%");
    expect(requests.querySelector("th[aria-sort]")?.textContent).toContain("Total time");
    expect(requests.textContent).toContain(
      "14 routes · 7 min 0 s in all; the % is each one's share of it.",
    );

    act(() => button(requests, "Show all 14").click());
    expect(rows()).toHaveLength(14);
    const unmatched = rows().find((row) => row.textContent?.includes("Unmatched"));
    expect(unmatched?.querySelector("th")?.textContent).toBe("Unmatched: no route answered");
    expect(unmatched?.querySelector("th")?.className).toContain("stats-slowest-plain");
    act(() => button(requests, "Show the first 10").click());
    expect(rows()).toHaveLength(10);

    act(() => button(requests, "Sort by Requests").click());
    expect(rows()[0]?.textContent).toContain("GET/api/tasks1,184");
    expect(requests.querySelector("th[aria-sort='descending']")?.textContent).toContain("Requests");
  });

  it("steps a chart's Tooltips with the keyboard and shows its figures as a table", async () => {
    const { opened } = openHealth();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("now 23% of one core"));
    const cpu = block(page, "CPU and memory");
    const chart = cpu.querySelector<HTMLElement>("[role='img']");
    if (!chart) throw new Error("No chart.");
    expect(chart.getAttribute("aria-label")).toContain("The Office's CPU over the last hour");

    act(() => chart.focus());
    expect(tipShown()).toContain("The Office23% of one core");
    expect(tipShown()).toContain("Of the workstation1%");
    act(() => {
      chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(tipShown()).toContain("The Office18% of one core");
    act(() => {
      chart.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(tipShown()).toContain("23%");

    act(() => button(cpu, "Show as a table").click());
    const table = cpu.querySelector("table");
    expect(table?.querySelector("thead")?.textContent).toContain("Reading");
    expect(table?.querySelector("thead")?.textContent).toContain("The Office's CPU, of one core");
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(30);
  });

  it("keeps the range in the address and reads it, Load now staying", async () => {
    const day: SystemHealth = {
      range: "24h",
      loadNow: LOAD_NOW,
      readings: {
        ...HOUR,
        from: new Date(TO - 24 * 60 * 60 * 1000).toISOString(),
        stepSeconds: 300,
        points: POINTS.map((point, index) => ({
          ...point,
          at: new Date(TO - (29 - index) * 300 * 1000).toISOString(),
        })),
        slowestQueries: HOUR.slowestQueries.map(
          ({ shape: _shape, calledFrom: _calledFrom, ...row }) => row,
        ),
      },
    };
    delete (day.readings as { readingsSince?: string }).readingsSince;
    const { sent, opened } = openHealth({
      "GET /api/stats/system-health?range=24h": () => ({ status: 200, body: day }),
    });
    const { page, router } = await opened;
    await until(() => expect(page.textContent).toContain("Slowest routes"));

    act(() => rangeTab(page, "24 h").click());
    await until(() =>
      expect(sent.map(({ request }) => request)).toContain(
        "GET /api/stats/system-health?range=24h",
      ),
    );
    expect(router.state.location.search).toEqual({ range: "24h" });
    await until(() =>
      expect(page.textContent).toContain("Slowest queries, by operation and table"),
    );
    expect(page.textContent).toContain("18.4k requests in the last 24 hours");
    expect(page.textContent).toContain("highest p99");
    expect(page.textContent).toContain(
      "24 h, 7 d and 30 d cover what The Office has sent Grafana since it started sending these measurements.",
    );
    expect(page.textContent).toContain("Nothing sent yet");
    expect(page.textContent).toContain(
      "Grafana keeps queries by operation and table only, never their statements.",
    );
    expect(block(page, "Load now").textContent).toContain("4Sessions running");
  });

  it("says why the longer ranges show nothing without Grafana, and shows the last hour again", async () => {
    const { opened } = openHealth({
      "GET /api/stats/system-health?range=7d": () => ({
        status: 200,
        body: { range: "7d", loadNow: LOAD_NOW, readings: { state: "not-on" } },
      }),
    });
    const { page, router } = await opened;
    await until(() => expect(page.textContent).toContain("Sessions running"));
    await act(() => router.navigate({ to: "/stats/system-health", search: { range: "7d" } }));

    await until(() =>
      expect(page.textContent).toContain("Turn on Grafana in Settings › Telemetry to see more."),
    );
    const card = page.querySelector<HTMLElement>("section[aria-label='The longer ranges']");
    expect(card?.textContent).toContain(
      "24 h, 7 d and 30 d read the measurements The Office sends Grafana.",
    );
    expect(card?.querySelector("a[href='/settings/telemetry']")).not.toBeNull();
    expect(block(page, "Load now").textContent).toContain("4Sessions running");
    expect(page.textContent).not.toContain("Responsiveness");

    act(() => button(page, "Show the last hour").click());
    await until(() => expect(page.textContent).toContain("Responsiveness"));
    expect(router.state.location.search).toEqual({});
  });

  it("puts Grafana's state above the card on a longer range, in Tokens and cost's words", async () => {
    const { opened } = openHealth({
      "GET /api/stats/system-health?range=30d": () => ({
        status: 200,
        body: {
          range: "30d",
          loadNow: LOAD_NOW,
          readings: { state: "rejected", address: "https://grafana.example.com" },
        },
      }),
    });
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Sessions running"));
    act(() => rangeTab(page, "30 d").click());

    await until(() => expect(page.textContent).toContain("Grafana refused the read token"));
    expect(page.textContent).toContain("24 h, 7 d and 30 d show once Grafana answers.");
    expect(page.textContent).toContain("Show the last hour");
  });

  it("shows Unreachable's words on a block Grafana didn't answer for", async () => {
    const week: SystemHealth = {
      range: "7d",
      loadNow: LOAD_NOW,
      readings: {
        ...HOUR,
        stepSeconds: 3600,
        unansweredBlocks: ["database"],
        address: "http://127.0.0.1:3300",
      },
    };
    const { opened } = openHealth({
      "GET /api/stats/system-health?range=7d": () => ({ status: 200, body: week }),
    });
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Sessions running"));
    act(() => rangeTab(page, "7 d").click());

    await until(() =>
      expect(block(page, "Database").textContent).toContain(
        "Couldn't reach Grafana at http://127.0.0.1:3300",
      ),
    );
    expect(block(page, "Requests").textContent).toContain("requests in the last 7 days");
  });

  it("says it couldn't read System health, and reads again on Try again", async () => {
    let failing = true;
    const { opened } = openHealth({
      "GET /api/stats/system-health?range=1h": () =>
        failing ? { status: 500, body: { message: "Down." } } : { status: 200, body: HEALTH },
    });
    const { page } = await opened;

    await until(() => expect(page.textContent).toContain("Couldn't read System health"));
    expect(page.textContent).toContain("The Office didn't answer within 10 seconds.");
    expect(page.querySelector("section[aria-labelledby]")).toBeNull();

    failing = false;
    act(() => button(page, "Try again").click());
    await until(() => expect(page.textContent).toContain("Responsiveness"));
    expect(page.textContent).not.toContain("Couldn't read System health");
  });

  it("says when nothing is read yet", async () => {
    const { opened } = openHealth({
      "GET /api/stats/system-health?range=1h": () => ({
        status: 200,
        body: {
          ...HEALTH,
          readings: { ...HOUR, points: [], slowestRoutes: [], slowestQueries: [] },
        },
      }),
    });
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Sessions running"));
    expect(block(page, "Responsiveness").textContent).toContain(
      "Nothing read yet. The first Health reading comes within 5 seconds of The Office starting.",
    );
  });

  it("goes between the tabs, Tokens and cost at /stats", async () => {
    const { opened } = openHealth();
    const { page, router } = await opened;
    await until(() => expect(page.textContent).toContain("Sessions running"));

    act(() => statsTab(page, "Tokens and cost").click());
    await until(() => expect(router.state.location.pathname).toBe("/stats"));
    await until(() => expect(heading?.crumb).toBe("Tokens and cost"));

    act(() => statsTab(page, "System health").click());
    await until(() => expect(router.state.location.pathname).toBe("/stats/system-health"));
    await until(() => expect(page.textContent).toContain("Load now"));
  });
});

function intervalOf(range: "1h" | "24h", data: SystemHealth | undefined): unknown {
  const { refetchInterval, refetchIntervalInBackground } = statsQueries.systemHealth(range);
  expect(refetchIntervalInBackground).toBe(false);
  if (typeof refetchInterval !== "function") throw new Error("No refetch interval.");
  return refetchInterval({ state: { data } } as Parameters<typeof refetchInterval>[0]);
}

describe("reading System health again", () => {
  it("reads the last hour every 5 s, the longer ranges every minute, every 3 s while Grafana starts", () => {
    expect(intervalOf("1h", HEALTH)).toBe(5_000);
    expect(intervalOf("24h", undefined)).toBe(60_000);
    expect(
      intervalOf("24h", {
        range: "24h",
        loadNow: LOAD_NOW,
        readings: { state: "starting", address: "http://127.0.0.1:3300" },
      }),
    ).toBe(3_000);
  });
});
